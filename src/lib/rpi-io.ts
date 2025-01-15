import * as utils						from '@iobroker/adapter-core';
import { IoAdapter, StateChange }		from './io-adapter';
import { I2cBus }						from './i2c-bus';
import { MCP23017 }						from './i2c-mcp23017';
import   rpio							from 'rpio';		// tried also 'onoff', 'opengpio', 'pigpio', 'pigpio-client' but didn't work
import   debounce						from 'debounce';

// Note on GPIO pins:		Störungen im Stromnetz führen zu phantom GPIO events
//		vor allem wenn der Gasbrenner sich ein oder ausschaltet
//		vor allem bei geschlossenen Sensor-Stromkreisen

// ~~~~~~~~~
// IoAdapter
// ~~~~~~~~~
export class RpiIo extends IoAdapter {
	private i2cBus?:			I2cBus;
	//private gpioPollTimer:		ioBroker.Timeout		= null;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({...options, 'name': 'rpi-io' });
	}

	/**
	 *
	 */
	protected override async onReady(): Promise<void> {
		try {
			await this.setState('info.connection', false, true);
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
			this.log.error((e instanceof Error) ? (e.stack ?? String(e)) : String(e));
			await this.setState('info.connection', false, true);
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
		const debounceMs = this.config.GpioDebounceMs;

		// init gpio input pin
		for (const input of this.config.GpioInput) {
			const { gpioNum, state: ownState, name, role, inverted, pollSecs, history } = input;
			const stateId = `${channelId}.${ownState}`;
			this.logf.debug('%-15s %-15s %-10s %-50s %-25s %s', this.constructor.name, 'init_gpio()', 'input', stateId, name, role);

			// open GPIO INPUT pin
			rpio.open(gpioNum, rpio.INPUT, rpio.PULL_UP);

			// readPin()
			const readPin = (): boolean => {
				const  phy   = (rpio.read(gpioNum) === rpio.HIGH);
				return phy !== inverted;
			};

			// create/update state object
			await this.writeStateObj(stateId, {
				'common': {
					'name':		name,
					'role':		role,
					'desc':		`GPIO ${String(gpioNum)} INPUT${inverted ? ' inverted' : ''}`,
					'read':		true,
					'write':	false,
					'def':		false,
				},
				'history':		{ 'enabled': history }
			});

			// initialize state
			const pinVal   = readPin();
			const pinState = await this.readState(stateId);
			if (pinVal !== pinState?.val) {
				await this.writeState(stateId, { 'val': pinVal, 'ack': true });
			}

			// poll gpio input pin values
			let   pollTimer: ioBroker.Timeout = null
			const pollRestart = () => {
				if (pollTimer) {
					this.clearTimeout(pollTimer);
				}
				pollTimer = this.setTimeout(async () => {
					const pinState = await this.readState(stateId);
					const pinVal   = readPin();
					if (pinVal !== pinState?.val) {
						this.logf.warn('%-15s %-15s %-10s %-50s %s after %d s', this.constructor.name, 'init_gpio()', 'pollTimer', name, (pinVal ? 'ON' : 'OFF'), pollSecs);
						await this.writeState(stateId, { 'val': pinVal, 'ack': true });
					}
					pollTimer = null;
					pollRestart();
				}, 1000*pollSecs) ?? null;
			};
			if (pollSecs > 0) {
				pollRestart();
			}

			// write (debounced) input pin state
			const pinHandler = (_pin: number) => {
				if (pollSecs > 0) {
					pollRestart();
				}
				void this.readState(stateId).then((pinState: ioBroker.State | null) => {
					const pinVal   = readPin();
					if (pinVal !== pinState?.val) {
						void this.writeState(stateId, { val: pinVal, 'ack': true });
					}
				});
			};

			// handle gpio input pin val changes
			const debounced = (debounceMs > 0) ? debounce(pinHandler, debounceMs) : pinHandler;
			rpio.poll(gpioNum, debounced, rpio.POLL_BOTH);
		}

		// debug log input state changes
		for (const input of this.config.GpioInput) {
			const stateId = `${channelId}.${input.state}`;
			if (stateId !== this.config.McpResetStateId) {
				await this.subscribe({ stateId, 'ack': true, 'cb': async (_stateChange: StateChange) => { /* empty */ } });
			}
		}

		// ~~~~~~~~~~
		// GpioOutput
		// ~~~~~~~~~~

		// init gpio output pin
		for (const output of this.config.GpioOutput) {
			const stateId = `${channelId}.${output.state}`;
			this.logf.debug('%-15s %-15s %-10s %-50s %-25s %s', this.constructor.name, 'init_gpio()', 'output', stateId, output.name, output.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'common': {
					'name':		output.name,
					'role':		output.role,
					'desc':		`GPIO ${String(output.gpioNum)} OUTPUT${output.inverted ? ' inverted' : ''} default ${output.default ? 'ON' : 'OFF'}${output.autoOffSecs > 0 ? ' auto-off '+String(output.autoOffSecs)+' s' : ''}`,
					'read':		true,
					'write':	true,
					'def':		output.default,
				},
				'history':		{ 'enabled': output.history }
			});

			// initialize state
			const pinState = await this.readState(stateId);
			const pinVal   = (typeof pinState?.val === 'boolean') ? pinState.val : output.default;
			if (pinState?.val !== pinVal) {
				await this.writeState(stateId, { 'val': pinVal, 'ack': true });
			}

			// open and init GPIO OUTPUT pin
			rpio.open(output.gpioNum, rpio.OUTPUT, (pinVal !== output.inverted) ? rpio.HIGH : rpio.LOW);
		}

		// subscribe output state change changes
		for (const output of this.config.GpioOutput) {
			const stateId = `${channelId}.${output.state}`;
			// on output cmd --> write pin --> set output ack
			await this.subscribe({ stateId, 'ack': false, 'cb': async (stateChange: StateChange) => {
				const pinVal = (stateChange.val === true);
				rpio.write(output.gpioNum, (pinVal !== output.inverted) ? rpio.HIGH : rpio.LOW);
				await this.writeState(stateId, { val: pinVal, 'ack': true });
			}});

			// on output true ack --> wait autoOffSecs --> set ouput false cmd
			if (output.autoOffSecs > 0) {
				await this.subscribe({ stateId, 'val': true, 'ack': true, 'cb': (_stateChange: StateChange) => {
					this.setTimeout(() => {
						void this.writeState(stateId, { 'val': false, 'ack': false });
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
		this.i2cBus = await I2cBus.open(this.config.I2cBusNb);

		const i2cAddrs = await this.i2cBus.scan();
		this.logf.debug('%-15s %-15s %-10s %-50s', this.constructor.name, 'init_i2c()', 'devices', JSON.stringify(i2cAddrs.map(addr => `0x${addr.toString(16)}`)));

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
			this.logf.debug('%-15s %-15s %-10s %-50s %-25s %s', this.constructor.name, 'init_mcp23017()', 'input', stateId, input.name, input.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'common': {
					'name':		input.name,
					'role':		input.role,
					'desc':		`MCP ${input.mcpPin} INPUT${input.inverted ? ' inverted' : ''}`,
					'read':		true,
					'write':	false,
					'def':		false,
				},
				'history':		{ 'enabled': input.history }
			});

			// initialize state
			const pinState = await this.readState(stateId);
			const pinVal   = (typeof pinState?.val === 'boolean') ? pinState.val : false;
			if (pinVal !== pinState?.val) {
				await this.writeState(stateId, { 'val': pinVal, 'ack': true });
			}

			// open MCP23017 INPUT pin
			mcp.register_pin({ 'pinName': input.mcpPin, 'initVal': pinVal, 'onChange': async (phy: boolean) => {
				const pinState = await this.readState(stateId);
				const pinVal = (phy !== input.inverted);
				if (pinVal !== pinState?.val) {
					await this.writeState(stateId, { val: pinVal, 'ack': true });		// set val ack
				}
			}});
		}

		// check mcp input pins every McpPollSecs
		if (this.config.McpPollSecs > 0) {
			this.setInterval(async () => {
				const pinChange = await mcp.readInputs();
				if (pinChange) {
					this.logf.warn('%-15s %-15s %-10s %-50s 0b%016b', this.constructor.name, 'setInterval()', 'mismatch', 'pinChange', pinChange);
				}
			}, 1000*this.config.McpPollSecs);
		}

		// debug log input state changes
		for (const input of this.config.McpInput) {
			const stateId = `${channelId}.${input.state}`;
			await this.subscribe({ stateId, 'ack': true, 'cb': async (_stateChange: StateChange) => { /* empty */ }});
		}

		// ~~~~~~~~~
		// McpOutput
		// ~~~~~~~~~

		// init mcp output pin
		for (const output of this.config.McpOutput) {
			const stateId = `${channelId}.${output.state}`;
			this.logf.debug('%-15s %-15s %-10s %-50s %-25s %s', this.constructor.name, 'init_mcp23017()', 'output', stateId, output.name, output.role);

			// create/update state object
			await this.writeStateObj(stateId, {
				'common': {
					'name':		output.name,
					'role':		output.role,
					'desc':		`MCP ${output.mcpPin} OUTPUT${output.inverted ? ' inverted' : ''} default ${output.default ? 'ON' : 'OFF'}${output.autoOffSecs > 0 ? ' auto-off '+String(output.autoOffSecs)+' s' : ''}`,
					'read':		true,
					'write':	true,
					'def':		output.default,
				},
				'history':		{ 'enabled': output.history }
			});

			// initialize state
			const pinState = await this.readState(stateId);
			const pinVal = (typeof pinState?.val === 'boolean') ? pinState.val : output.default;
			if (pinVal !== pinState?.val) {
				await this.writeState(stateId, { 'val': pinVal, 'ack': true });
			}

			// open MCP23017 OUTPUT pin
			mcp.register_pin({ 'pinName': output.mcpPin, 'initVal': (pinVal !== output.inverted) });
		}

		// subscribe output state change changes
		for (const output of this.config.McpOutput) {
			const stateId = `${channelId}.${output.state}`;

			// on output cmd --> write pin --> set output ack
			await this.subscribe({ stateId, 'ack': false, 'cb': async (stateChange: StateChange) => {
				const pinVal = (stateChange.val === true);
				await mcp.setOutput({ 'pinName': output.mcpPin, 'pinVal': (pinVal !== output.inverted) });
				await this.writeState(stateId, { val: pinVal, 'ack': true });
			}});

			// on output true ack --> wait autoOffSecs --> set ouput false cmd
			if (output.autoOffSecs > 0) {
				await this.subscribe({ stateId, 'val': true, 'ack': true, 'cb': (_stateChange: StateChange) => {
					this.setTimeout(() => {
						void this.writeState(stateId, { 'val': false, 'ack': false });
					}, 1000*output.autoOffSecs);
				}});
			}
		}

		// on McpIntStateId true ack --> mcp.readInputs()
		if (await this.readStateObject(this.config.McpIntStateId)) {
			await this.subscribe({'stateId': this.config.McpIntStateId, 'val': true, 'ack': true, 'cb': async (_stateChange: StateChange) => {
				await mcp.readInputs();
			}});
		}

		// McpResetStateId
		if (await this.readStateObject(this.config.McpResetStateId)) {
			// initialize to false ack
			await this.writeState(this.config.McpResetStateId, { 'val': false, 'ack': true });

			// on McpResetState ON ack --> reset mcp --> set McpResetState OFF cmd
			await this.subscribe({'stateId': this.config.McpResetStateId, 'ack': true, 'cb': async (pinState: StateChange) => {
				// ON ack --> OFF cmd
				if (pinState.val) {
					await this.writeState( this.config.McpResetStateId, { 'val': false, 'ack': false });

				// OFF ack --> wait 200 ms --> init mcp
				} else {
					this.setTimeout(async () => {
						await mcp.init();
						await mcp.readInputs();
					}, 200);
				}
			}});
		}

		// start
		await mcp.init();
		await mcp.readInputs();
	}
}
