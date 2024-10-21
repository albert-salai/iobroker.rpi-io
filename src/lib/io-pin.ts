import { IoOwnState }		from './io-object';
import   rpio				from 'rpio';			// tried also 'onoff', 'opengpio', 'pigpio', 'pigpio-client' but didn't work

// rpio:
//		interrupts are not supported.
//		rpio.poll() merely reports that an event happened in the time period since the last poll
//		poll interval is hard coded 1 ms



// IoPinConfig
export interface IoPinConfig {
	num:				number,
	inverted:			boolean,
	debounceMs:			number,
	autoOffMs:			number,
};

// IoPinObject
export interface IoPinObject {
	common: {
		name:			string,
		desc:			string,
		role:			string,
		write:			boolean,
		def:			boolean,
	},
	native: {
		pinConfig:		IoPinConfig
	}
};


// ~~~~~~~
// GpioPin
// ~~~~~~~
export class GpioPin extends IoOwnState {
	private readonly pinConfig: IoPinConfig;
	private started = false;

	/**
	 *
	 * @param stateId
	 * @param pinObject
	 */
	public constructor(stateId: string, pinObject: IoPinObject) {
		super(stateId, {
			'common':	{...pinObject.common,	type: 'boolean' },
			'native':		pinObject.native
		});
		this.pinConfig = pinObject.native.pinConfig;
	}

	/**
	 *
	 */
	public override async onReady(): Promise<void> {
		await super.onReady();
		this.logf.debug('%-15s %-15s %-10s %-40s %s', this.constructor.name, 'onReady()', 'pinConfig', this.ownId(), JSON.stringify(this.pinConfig, null, 4));

		// log ack; log cmd; changes only
		this.setLog({ 'ack': true, 'cmd': true, 'unchanged': false });

		// ~~~~~~~~~~~~~~~
		// GPIO OUTPUT pin
		// ~~~~~~~~~~~~~~~
		if (this.common.write) {
			// create GPIO OUTPUT pin
			rpio.open(this.pinConfig.num, rpio.OUTPUT, (this.curr.val ? rpio.LOW : rpio.HIGH));

			// handle iobroker state cmd
			if (this.started === false) {
				this.started   = true;
				this.adapter.subscribe({ 'stateId': this.objId, 'ack': false, 'cb': async (stateChange: ioBroker.State) => {
					const phyVal = (stateChange.val !== this.pinConfig.inverted);
					rpio.write(this.pinConfig.num, (phyVal ? rpio.HIGH : rpio.LOW));
					await this.adapter.setForeignStateAsync(this.objId, { 'val': stateChange.val, 'ack': true });		// set val ack
				}});
			}

		// ~~~~~~~~~~~~~~
		// GPIO INPUT pin
		// ~~~~~~~~~~~~~~
		} else {
			// create GPIO INPUT pin
			rpio.open(this.pinConfig.num, rpio.INPUT, rpio.PULL_UP);

			// updatePin(pinNum)
			const updatePin = async (pinNum: number): Promise<void> => {
				const phyVal = (rpio.read(pinNum) === rpio.HIGH);
				const pinVal = (phyVal !== this.pinConfig.inverted);
				const state  = await this.adapter.getForeignStateAsync(this.objId);
				if (pinVal !== state?.val) {
					await this.adapter.setForeignStateAsync(this.objId, { 'val': pinVal, 'ack': true });
				}
			};

			// init
			await updatePin(this.pinConfig.num);

			// call updatePin(pinNum) immediately
			const debounceMs = this.pinConfig.debounceMs;
			if (debounceMs <= 0) {
				rpio.poll(this.pinConfig.num, updatePin, rpio.POLL_BOTH);

			// call updatePin(pinNum) after debounceMs
			} else {
				let ioTimeout: ioBroker.Timeout | undefined;
				rpio.poll(this.pinConfig.num, (pinNum: number) => {
					this.adapter.clearTimeout(ioTimeout);
					ioTimeout = this.adapter.setTimeout(async () => {
						await updatePin(pinNum);
					}, debounceMs);
				}, rpio.POLL_BOTH);
			}
		}

		// start logging unchanged values in 100 ms
		this.adapter.setTimeout(async () => {
			this.setLog({ 'ack': true, 'cmd': true, 'unchanged': true });
		}, 100);
	}
};
