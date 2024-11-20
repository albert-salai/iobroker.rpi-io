import * as utils										from '@iobroker/adapter-core';
import { IoAdapter, StateChange, dateStr, valStr }		from './io-adapter';
import { I2cBus }										from './i2c-bus';
import { MCP23017 }										from './i2c-mcp23017';
import   rpio											from 'rpio';		// tried also 'onoff', 'opengpio', 'pigpio', 'pigpio-client' but didn't work

// ~~~~~~~~~
// IoAdapter
// ~~~~~~~~~
export class RpiIo extends IoAdapter {
	private i2cBus?:		I2cBus;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({...options, 'name': 'rpi-io' });
	}

	/**
	 *
	 */
	protected override async onReady(): Promise<void> {
		try {
			this.setState('info.connection', false, true);
			await super.onReady();
			//this.logf.debug('%-15s %-15s %-40s\n%s', this.constructor.name, 'onReady()', 'config', JSON.stringify(this.config, null, 4));

			const channelId = `${this.namespace}.pin`;
			await this.writeChannelObj(channelId, { 'name': 'Pin' });
			await this.init_gpio(channelId);
			await this.init_i2c(channelId);

			// ready
			await this.setState('info.connection', true, true);
			this.logf.debug('%-15s %-15s %-40s', this.constructor.name, 'onReady()', 'done');

		} catch (e: unknown) {
			this.log.error(`${e}\n${(e instanceof Error) ? e.stack : JSON.stringify(e)}`);
			this.setState('info.connection', false, true);
		}
	}

	/**
	 *
	 * @param callback
	 */
	protected override async onUnload(): Promise<void> {
		await this.i2cBus?.close();

		await super.onUnload();
	}

	/**
	 *
	 * @param channelId
	 */
	private async init_gpio(channelId: string): Promise<void> {
		this.logf.info('%-15s %-15s', this.constructor.name, 'init_gpio()');

		// Use the GPIOxx numbering
		rpio.init({ 'mapping': 'gpio' });

		// ~~~~~~~~~
		// GpioInput
		// ~~~~~~~~~

		// init gpio input pin
		for (const input of this.config.GpioInput) {
			const stateId = `${channelId}.${input.state}`;
			this.logf.debug('%-15s %-15s %-10s %-45s %-25s %s', this.constructor.name, 'init_gpio()', 'input', stateId, input.name, input.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'name':		input.name,
				'role':		input.role,
				'desc':		`GPIO ${input.gpioNum} INPUT${input.inverted ? ' inverted' : ''}`,
				'type':		'boolean',
				'read':		true,
				'write':	false,
			});

			// open GPIO INPUT pin
			rpio.open(input.gpioNum, rpio.INPUT, rpio.PULL_UP);

			// readPin()
			const readPin = (): boolean => {
				const  phy   = (rpio.read(input.gpioNum) === rpio.HIGH);
				return phy !== input.inverted;
			};

			// initialize state
			const stateObj = await this.readState(stateId);
			const stateVal = readPin();
			if (stateObj?.val !== stateVal) {
				await this.writeState(stateId, { 'val': stateVal, 'ack': true });
			}

			// handle gpio input pin val changes
			rpio.poll(input.gpioNum, (_pin: number) => {
				const val = readPin();
				this.runExclusive(async () => {
					await this.writeState(stateId, { val, 'ack': true });
				})
			}, rpio.POLL_BOTH);
		}

		// check gpio input pins every GpioPollSecs
		if (this.config.GpioPollSecs > 0) {
			this.setInterval(() => {
				this.runExclusive(async () => {
					for (const input of this.config.GpioInput) {
						const stateId	= `${channelId}.${input.state}`;
						const stateObj	= await this.readState(stateId);
						const phy		= (rpio.read(input.gpioNum) === rpio.HIGH);
						const val		= phy !== input.inverted;
						if (stateObj  &&  stateObj.val !== val) {
							this.logf.warn('%-15s %-15s %-10s %-45s %s   %-3s %s', this.constructor.name, 'setInterval()', 'mismatch', stateId, dateStr(Date.now()), '', valStr(stateObj.val));
							await this.writeState(stateId, { val, 'ack': true });
						}
					}
				});
			}, 1000*this.config.GpioPollSecs);
		}

		// debug log input state changes
		for (const input of this.config.GpioInput) {
			const stateId = `${channelId}.${input.state}`;
			if (stateId !== this.config.McpResetStateId) {
				this.subscribe({ stateId, 'ack': true, 'cb': async (_stateChange: StateChange) => {} });
			}
		}

		// ~~~~~~~~~~
		// GpioOutput
		// ~~~~~~~~~~

		// init gpio output pin
		for (const output of this.config.GpioOutput) {
			const stateId = `${channelId}.${output.state}`;
			this.logf.debug('%-15s %-15s %-10s %-45s %-25s %s', this.constructor.name, 'init_gpio()', 'output', stateId, output.name, output.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'name':		output.name,
				'role':		output.role,
				'desc':		`GPIO ${output.gpioNum} OUTPUT${output.inverted ? ' inverted' : ''} default ${output.default ? 'ON' : 'OFF'}${output.autoOffSecs > 0 ? ' auto-off '+output.autoOffSecs+' s' : ''}`,
				'type':		'boolean',
				'read':		true,
				'write':	true,
			});

			// initialize state
			const stateObj = await this.readState(stateId);
			const stateVal = (typeof stateObj?.val === 'boolean') ? stateObj.val : output.default;
			if (stateObj?.val !== stateVal) {
				await this.writeState(stateId, { 'val': stateVal, 'ack': true });
			}

			// open and init GPIO OUTPUT pin
			rpio.open(output.gpioNum, rpio.OUTPUT, (stateVal !== output.inverted) ? rpio.HIGH : rpio.LOW);
		}

		// subscribe output state change changes
		for (const output of this.config.GpioOutput) {
			const stateId = `${channelId}.${output.state}`;
			// on output cmd --> write pin --> set output ack
			this.subscribe({ stateId, 'ack': false, 'cb': async (stateChange: StateChange) => {
				const val = (stateChange.val === true);
				rpio.write(output.gpioNum, (val !== output.inverted) ? rpio.HIGH : rpio.LOW);
				await this.writeState(stateId, { val, 'ack': true });
			}});

			// on output true ack --> wait autoOffSecs --> set ouput false cmd
			if (output.autoOffSecs > 0) {
				this.subscribe({ stateId, 'val': true, 'ack': true, 'cb': async (_stateChange: StateChange) => {
					this.setTimeout(() => {
						this.writeState(stateId, { 'val': false, 'ack': false });
					}, 1000*output.autoOffSecs);
				}});
			}
		}
	}

	/**
	 *
	 * @param channelId
	 */
	private async init_i2c(channelId: string): Promise<void> {
		this.i2cBus = await I2cBus.open(this.config['I2cBusNb']);

		if (this.i2cBus) {
			const i2cAddrs = await this.i2cBus.scan();
			this.logf.debug('%-15s %-15s %-10s %-45s', this.constructor.name, 'init_i2c()', 'devices', JSON.stringify(i2cAddrs.map(addr => `0x${addr.toString(16)}`)));

			for (const i2cAddr of i2cAddrs) {
				// found MCP23017
				if (i2cAddr === 0x20) {
					await this.init_mcp23017(channelId, this.i2cBus, i2cAddr);

				// found MCP2324
				} else if (i2cAddr === 0x68) {
					this.logf.debug('%-15s %-15s %-10s MCP2324 0x%02X not implemented',		this.constructor.name, 'init_i2c()', '', i2cAddr);

				// found DS2482
				} else if (i2cAddr === 0x18) {
					this.logf.debug('%-15s %-15s %-10s DS2482 0x%02X not implemented',		this.constructor.name, 'init_i2c()', '', i2cAddr);

				} else {
					this.logf.debug('%-15s %-15s %-10s I2C device 0x%02X not implemented',	this.constructor.name, 'init_i2c()', 'error', i2cAddr);
				}
			}
		}
	}

	/**
	 *
	 * @param channelId
	 * @param i2cBus
	 * @param i2cAddr
	 */
	private async init_mcp23017(channelId: string, i2cBus: I2cBus, i2cAddr: number): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s MCP23017 0x%02X', this.constructor.name, 'init_mcp23017()', '', i2cAddr);

		// create mcp IoDevice
		const mcp = new MCP23017({
			'i2cBus':		i2cBus,
			'i2cAddr':		i2cAddr,
		});

		// ~~~~~~~~
		// McpInput
		// ~~~~~~~~

		// init mcp input pin
		for (const input of this.config.McpInput) {
			const stateId = `${channelId}.${input.state}`;
			this.logf.debug('%-15s %-15s %-10s %-45s %-25s %s', this.constructor.name, 'init_mcp23017()', 'input', stateId, input.name, input.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'name':		input.name,
				'role':		input.role,
				'desc':		`MCP ${input.mcpPin} INPUT${input.inverted ? ' inverted' : ''}`,
				'type':		'boolean',
				'read':		true,
				'write':	false,
			});

			// initialize state
			const stateObj = await this.readState(stateId);
			const stateVal = (typeof stateObj?.val === 'boolean') ? stateObj.val : false;
			if (stateObj?.val !== stateVal) {
				await this.writeState(stateId, { 'val': stateVal, 'ack': true });
			}

			// open MCP23017 INPUT pin
			mcp.register_pin({ 'pinName': input.mcpPin, 'initVal': stateVal, 'onChange': async (phy: boolean) => {
				const val = (phy !== input.inverted);
				const state = await this.readState(stateId);
				if (state?.val !== val) {
					await this.writeState(stateId, { val, 'ack': true });		// set val ack
				}
			}});
		}

		// check mcp input pins every McpPollSecs
		if (this.config.McpPollSecs > 0) {
			this.setInterval(() => {
				this.runExclusive(async () => {
					const pinChange = await mcp.readInputs();
					if (pinChange) {
						this.logf.warn('%-15s %-15s %-10s %-45s 0b%016b', this.constructor.name, 'setInterval()', 'mismatch', 'pinChange', pinChange);
					}
				});
			}, 1000*this.config.McpPollSecs);
		}

		// debug log input state changes
		for (const input of this.config.McpInput) {
			const stateId = `${channelId}.${input.state}`;
			this.subscribe({ stateId, 'ack': true, 'cb': async (_stateChange: StateChange) => {}});
		}

		// ~~~~~~~~~
		// McpOutput
		// ~~~~~~~~~

		// init mcp output pin
		for (const output of this.config.McpOutput) {
			const stateId = `${channelId}.${output.state}`;
			this.logf.debug('%-15s %-15s %-10s %-45s %-25s %s', this.constructor.name, 'init_mcp23017()', 'output', stateId, output.name, output.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'name':		output.name,
				'role':		output.role,
				'desc':		`MCP ${output.mcpPin} OUTPUT${output.inverted ? ' inverted' : ''} default ${output.default ? 'ON' : 'OFF'}${output.autoOffSecs > 0 ? ' auto-off '+output.autoOffSecs+' s' : ''}`,
				'type':		'boolean',
				'read':		true,
				'write':	true,
			});

			// initialize state
			const stateObj = await this.readState(stateId);
			const stateVal = (typeof stateObj?.val === 'boolean') ? stateObj.val : output.default;
			if (stateObj?.val !== stateVal) {
				await this.writeState(stateId, { 'val': stateVal, 'ack': true });
			}

			// open MCP23017 OUTPUT pin
			mcp.register_pin({ 'pinName': output.mcpPin, 'initVal': (stateVal !== output.inverted) });
		}

		// subscribe output state change changes
		for (const output of this.config.McpOutput) {
			const stateId = `${channelId}.${output.state}`;

			// on output cmd --> write pin --> set output ack
			this.subscribe({ stateId, 'ack': false, 'cb': async (stateChange: StateChange) => {
				const val = (stateChange.val === true);
				await mcp.setOutput({ 'pinName': output.mcpPin, 'pinVal': (val !== output.inverted) });
				await this.writeState(stateId, { val, 'ack': true });
			}});

			// on output true ack --> wait autoOffSecs --> set ouput false cmd
			if (output.autoOffSecs > 0) {
				this.subscribe({ stateId, 'val': true, 'ack': true, 'cb': async (_stateChange: StateChange) => {
					this.setTimeout(() => {
						this.writeState(stateId, { 'val': false, 'ack': false });
					}, 1000*output.autoOffSecs);
				}});
			}
		}

		// on McpIntStateId true ack --> mcp.readInputs()
		if (await this.readStateObject(this.config.McpIntStateId)) {
			this.subscribe({'stateId': this.config.McpIntStateId, 'val': true, 'ack': true, 'cb': async (_stateChange: StateChange) => {
				await mcp.readInputs();
			}});
		}

		// McpResetStateId
		if (await this.readStateObject(this.config.McpResetStateId)) {
			// initialize to false ack
			await this.writeState(this.config.McpResetStateId, { 'val': false, 'ack': true });

			// on McpResetState ON ack --> reset mcp --> set McpResetState OFF cmd
			this.subscribe({'stateId': this.config.McpResetStateId,  'val': true,  'ack': true, 'cb': async (_stateChange: StateChange) => {
				await this.writeState( this.config.McpResetStateId, {'val': false, 'ack': false });		// set OFF cmd
				await mcp.reset();
			}});
		}

		// start
		await mcp.init();
		await mcp.readInputs();

		// FIXME
		this.config.McpPollSecs;
	}
}
