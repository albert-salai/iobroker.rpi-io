import { Adapter, AdapterOptions }		from '@iobroker/adapter-core';
import { Mutex }						from 'async-mutex';
import { sprintf }						from 'sprintf-js';
// see also
//		https://github.com/ioBroker/ioBroker/wiki/Adapter-Development-Documentation#structure-of-io-packagejson
//		https://github.com/ioBroker/ioBroker.js-controller/blob/master/packages/adapter/src/lib/adapter/adapter.ts

// dateStr(ts)
export function dateStr(ts: number = Date.now()): string {
	const  d = new Date(ts);
	return sprintf('%02d.%02d.%04d %02d:%02d:%02d', d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes(), d.getSeconds());
}

// valStr(ts)
export function valStr(val: ioBroker.StateValue): string {
	if		(       val ===  null		)	{ return 'null';				}
	if		(typeof val === 'string'	)	{ return  val;					}
	else if (typeof val ===	'boolean'	)	{ return (val) ? 'ON' : 'OFF';	}
	else                 /* 'number' */		{ return isFinite(val) ? (Math.round(val*1e6)/1e6).toString() : val.toString(); }
}


// default logf
const logf = {
	'silly':	(_fmt: string, ..._args: unknown[]): void => {},
	'info':		(_fmt: string, ..._args: unknown[]): void => {},
	'debug':	(_fmt: string, ..._args: unknown[]): void => {},
	'warn':		(_fmt: string, ..._args: unknown[]): void => {},
	'error':	(_fmt: string, ..._args: unknown[]): void => {},
};

// StateVal, StateChange
export type StateVal	= number | boolean | string;
export type StateChange	= { val: StateVal, ack: boolean, ts: number };

// StateChangeCb
type StateChangeCb = (stateChange: StateChange) => Promise<void>;

// StateChangeSpec
interface StateChangeSpec {
	stateId: 	string,
	cb:			StateChangeCb,
	val?:		boolean,			// val: true|false|undefined
	ack?:		boolean,			// ack: true|false|undefined
};

// WriteStateObj
type StateObjCommon		= ioBroker.SettableStateObject['common'];
type HistoryObj = {
	'enabled':						boolean,		// false
	'counter'?:						boolean,		// false		Counter
	'debounceTime'?:				number,			// 0			Only logs the value if it stays unchanged for X ms
	'blockTime'?:					number,			// 0			Ignore all new values for X ms after last logged value
	'changesOnly'?:					boolean,		// true			Record changes only
	'changesRelogInterval'?:		number,			// 0 			Record the same values (seconds)
	'changesMinDelta'?:				number,			// 0			Minimum difference from last value
	'ignoreBelowNumber'?:			string,			// ''			Ignore values below
	'disableSkippedValueLogging'?:	boolean,		// false		Disable charting optimized logging of skipped values
	'retention'?:					number,			// 0 			Storage retention (seconds)
	'maxLength'?:					number,			// 0			maximum datapoint count in RAM
	'enableDebugLogs'?:				boolean,		// false		Enable enhanced debug logs for the state
//	'ignoreAboveNumber'?:			string,			// 				Ignore values above
//	'round'?:						string,			// 				On query round numbers to
};
export type WriteStateObj = {
	'common':		Partial<StateObjCommon> & Pick<StateObjCommon, 'name' | 'type' | 'def'>,
	'native'?:		ioBroker.SettableStateObject['native'],
	'history'?:		HistoryObj,
};


// ~~~~~~~~~
// IoAdapter
// ~~~~~~~~~
export class IoAdapter extends Adapter {
	public static	this:				IoAdapter;
	public			logf														= logf;
	public			historyId													= '';		// 'sql.0'
	private			stateChangeSpecs:	Record<string, StateChangeSpec[]>		= {};		// by stateId
	private			stateObject:		Record<string, ioBroker.StateObject>	= {};		// by stateId
	private			mutex														= new Mutex();
	private			saveConfig:			boolean;

	/**
	 *
	 * @param options
	 */
	public constructor(options: AdapterOptions) {
		super(options);
		IoAdapter.this  = this;
		this.saveConfig = false;

		// on ready
		// ~~~~~~~~
		this.on('ready', async () => {
			try {
				this.setState('info.connection', false, true);

				// unhandledRejection
				process.on('unhandledRejection', (reason: string, p: Promise<unknown>) => {
					this.log.error(`unhandledRejection ${reason} ${JSON.stringify(p, null, 4)} ${(new Error('')).stack}`);
				});

				// uncaughtException
				process.on('uncaughtException', (err, origin) => {
					this.log.error(`uncaughtException ${err}\n${origin}`);
				});

				// logf
				const pad = ' '.repeat(Math.max(0, 16 - this.namespace.length));
				this.logf.silly		= (fmt: string, ...args) => this.log.silly(sprintf(pad		+ fmt, ...args));
				this.logf.info		= (fmt: string, ...args) => this.log.info (sprintf(pad+' '	+ fmt, ...args));
				this.logf.debug		= (fmt: string, ...args) => this.log.debug(sprintf(pad		+ fmt, ...args));
				this.logf.warn		= (fmt: string, ...args) => this.log.warn (sprintf(pad+' '	+ fmt, ...args));
				this.logf.error		= (fmt: string, ...args) => this.log.error(sprintf(pad		+ fmt, ...args));

				// historyId
				const systemConfig = await this.getForeignObjectAsync('system.config');
				this.historyId = systemConfig?.common.defaultHistory  ||  '';

				// call onReady()
				await this.onReady();
				await this.setState('info.connection', true, true);

				// save config and restart adapter
				if (this.saveConfig) {
					this.updateConfig(this.config);			// will restart adapter
					return;
				}

			} catch (e: unknown) {
				this.log.error(`${e}\n${(e instanceof Error) ? e.stack : JSON.stringify(e)}`);
				this.setState('info.connection', false, true);
			}
		});

		// on unload
		// ~~~~~~~~~
		this.on('unload', async (callback: () => void) => {
			try					{ await this.onUnload();															}
			catch (e: unknown)	{ this.log.error(`${e}\n${(e instanceof Error) ? e.stack : JSON.stringify(e)}`);	}
			finally				{ callback();																		}
		});

		// on stateChange
		// ~~~~~~~~~~~~~~
		this.on('stateChange', (stateId: string, state: ioBroker.State | null | undefined) => {
			this.runExclusive(async () => {				// handle state changes one-by-one!
				if (state)	{ await this.onChange(stateId, state); }
				else		{ this.logf.warn('%-15s %-15s %-10s %-45s', this.constructor.name, 'onChange()', 'deleted', stateId); }
			});
		});

		// this.on('objectChange',	this.onObjectChange.bind(this));
		// this.on('message',		this.onMessage.bind(this));
	}


	/**
	 *
	 */
	public save_config(): void {
		this.logf.warn('%-15s %-15s %-10s %-45s', this.constructor.name, 'save_config()', '', 'will restart ...');
		this.saveConfig = true;
	}


	/**
	 *
	 */
	protected async onReady(): Promise<void> {}


	/**
	 *
	 */
	protected async onUnload(): Promise<void> {}


	/**
	 *
	 * @param cb
	 * @returns
	 */
	public async runExclusive<T>(cb: () => Promise<T>): Promise<T> {
		return this.mutex.runExclusive(cb);
	}


	/**
	 *
	 * @param stateId
	 * @param common
	 */
	public async writeFolderObj(stateId: string, common: ioBroker.SettableFolderObject['common']): Promise<void> {
		const obj: ioBroker.SettableFolderObject = {
			'type':			'folder',
			'common':		common,
			'native':		{}
		};
		await this.setForeignObjectAsync(stateId, obj);
	}


	/**
	 *
	 * @param stateId
	 * @param common
	 */
	public async writeDeviceObj(stateId: string, common: ioBroker.SettableDeviceObject['common']): Promise<void> {
		const obj: ioBroker.SettableDeviceObject = {
			'type':			'device',
			'common':		common,
			'native':		{}
		};
		await this.setForeignObjectAsync(stateId, obj);
	}


	/**
	 *
	 * @param stateId
	 * @param common
	 */
	public async writeChannelObj(stateId: string, common: ioBroker.SettableChannelObject['common']): Promise<void> {
		const obj: ioBroker.SettableChannelObject = {
			'type':			'channel',
			'common':		common,
			'native':		{}
		};
		await this.setForeignObjectAsync(stateId, obj);
	}

	/**
	 *
	 * @param stateId
	 * @param common
	 */
	//
	public async writeStateObj(stateId: string, opts: WriteStateObj): Promise<ioBroker.StateObject> {
		// common, native
		let common	= { 'role': 'value',  'read': true, 'write': false, ...opts.common };
		let native	= opts.native ?? {};

		// update common, native from existing object
		const obj = await this.getForeignObjectAsync(stateId);
		if (obj) {
			native = Object.assign(obj.native, native);
			common = Object.assign(obj.common, common);
		}

		// history
		if (this.historyId) {
			const custom:  Record<string, any>		= common.custom		= common.custom ?? {};
			const history							= custom[this.historyId]			?? {};
			custom[this.historyId] = (opts.history?.enabled !== true) ? null : Object.assign(history, opts.history, {
				'storageType':	(common.type[0] || '').toUpperCase() + common.type.slice(1),
				'maxLength':	0,					// FIXME
			});
		}

		// create new or update existing object
		await this.setForeignObjectAsync(stateId, {
			'type':			'state',
			'common':		common,
			'native':		native
		});

		// return ioBroker.StateObject
		const stateObj = await this.getForeignObjectAsync(stateId);
		if (stateObj?.type !== 'state') {
			throw new Error(`${this.constructor.name}: writeStateObj(): invalid stateObj of ${stateId}`);
		}
		return stateObj;
	}


	/**
	 *
	 * @param stateId
	 * @returns
	 */
	public async readStateObject(stateId: string): Promise<ioBroker.StateObject | null> {
		const obj = await this.getForeignObjectAsync(stateId) ?? null;		// return null instead of undefined
		return (obj?.type === 'state') ? obj : null;
	}


	/**
	 *
	 * @param stateId
	 * @param state
	 */
	public async writeState(stateId: string, state: ioBroker.SettableState): Promise<void> {
		//this.logf.debug('%-15s %-15s %-10s %-45s %-25s %-3s %s', this.constructor.name, 'writeState()', '', stateId, this.dateStr(state.ts), (state.ack ? '' : 'cmd'), valStr(state.val));
		await this.setForeignStateAsync(stateId, state);
	}


	/**
	 *
	 * @param stateId
	 * @returns
	 */
	public async readState(stateId: string): Promise<ioBroker.State | null> {
		return (await this.getForeignStateAsync(stateId)) ?? null;			// return null instead of undefined
	}


	/**
	 *
	 * @param spec
	 */
	public async subscribe(spec: StateChangeSpec): Promise<void> {
		// add spec to stateChangeSpecs
		const stateId	= spec.stateId;
		const specs		= this.stateChangeSpecs[stateId] = this.stateChangeSpecs[stateId]  ||  [];
		const len		= specs.push(spec);
		this.logf.debug('%-15s %-15s %-10s %-45s %-4s %s', this.constructor.name, 'subscribe()', `#${len - 1}`, stateId, ''+('val' in spec ? spec.val : 'any'), ''+('ack' in spec ? (spec.ack ? 'ack' : 'cmd') : '*'));
		if (len === 1) {
			const stateObj = await this.readStateObject(stateId);
			if (stateObj) {
				this.stateObject[stateId] = stateObj;
				await this.subscribeForeignStatesAsync(stateId);
			}
		}
	}


	/**
	 *
	 * @param spec
	 */
	public async unsubscribe(spec: StateChangeSpec): Promise<void> {
		// remove spec from stateChangeSpecs
		const stateId  = spec.stateId;
		const specs		= (this.stateChangeSpecs[stateId] || []).filter((s) => (s !== spec));
		this.stateChangeSpecs[stateId] = specs;
		this.logf.debug('%-15s %-15s %-10s %-45s %-4s %s', this.constructor.name, 'unsubscribe()', `#${specs.length}`, stateId, ''+('val' in spec ? spec.val : 'any'), ''+('ack' in spec ? (spec.ack ? 'ack' : 'cmd') : '*'));
		if (specs.length === 0) {
			await this.unsubscribeForeignStatesAsync(stateId);
		}
	}


	/**
	 *
	 * @param spec
	 */
	public async subscribeOnce(spec: StateChangeSpec): Promise<void> {
		const cb = spec.cb;
		spec.cb = async (stateChange: StateChange) => {
			await this.unsubscribe(spec);
			await cb(stateChange);
		};
		await this.subscribe(spec);
	}


	/**
	 *
	 * @param stateId
	 * @param state
	 */
	private async onChange(stateId: string, iobState: ioBroker.State): Promise<void> {
		const { val, ack, ts } = iobState;

		if (val === null  ||  typeof val === 'string') {
			this.logf.error('%-15s %-15s %-10s %-45s %s   %-3s %s', this.constructor.name, 'onChange()', '', stateId, dateStr(ts), (ack ? '' : 'cmd'), JSON.stringify(val));

		} else {
			// call callbacks if opts do match
			const specs = this.stateChangeSpecs[stateId];
			if (! specs) {
				this.logf.error('%-15s %-15s %-10s %-45s %s   %-3s %s', this.constructor.name, 'onChange()', 'no spec', stateId, dateStr(ts), (ack ? '' : 'cmd'), valStr(val));

			} else {
				for (const spec of specs) {
					const valMatch = ('val' in spec) ? (spec.val === val) : true;
					const ackMatch = ('ack' in spec) ? (spec.ack === ack) : true;
					if (valMatch  &&  ackMatch) {
						await spec.cb({ val, ack, ts });
					}
				}
			}
		}
	}
}
