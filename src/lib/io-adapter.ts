import * as utils			from '@iobroker/adapter-core';
import { sprintf }			from 'sprintf-js';
import { Mutex }			from 'async-mutex';

// see also
//		https://github.com/ioBroker/ioBroker/wiki/Adapter-Development-Documentation#structure-of-io-packagejson


// Logf
interface Logf {
	silly:		(_fmt: string, ..._args: unknown[]) => void,
	info:		(_fmt: string, ..._args: unknown[]) => void,
	debug:		(_fmt: string, ..._args: unknown[]) => void,
	warn:		(_fmt: string, ..._args: unknown[]) => void,
	error:		(_fmt: string, ..._args: unknown[]) => void,
};

// StateChangeSpec, StateChangeCb
type StateChangeCb = (stateChange: ioBroker.State) => Promise<void>;
interface StateChangeSpec {
	stateId: 	string,
	cb:			StateChangeCb,
	val?:		boolean,
	ack?:		boolean,
};


// ~~~~~~~~~
// IoAdapter
// ~~~~~~~~~
export class IoAdapter extends utils.Adapter {
	public static self: IoAdapter;
	public	logf:				Logf;
	public	historyId:			string		= '';								// 'sql.0'
	private	stateChangeSpecs:	Record<string, StateChangeSpec[]>	= {};		// by stateId
	private	mutex:				Mutex;

	/**
	 *
	 * @param options
	 */
	public constructor(options: utils.AdapterOptions) {
		super(options);
		IoAdapter.self = this;

		this.logf = {
			'silly':		(_fmt: string, ..._args: unknown[]): void => {},
			'info':			(_fmt: string, ..._args: unknown[]): void => {},
			'debug':		(_fmt: string, ..._args: unknown[]): void => {},
			'warn':			(_fmt: string, ..._args: unknown[]): void => {},
			'error':		(_fmt: string, ..._args: unknown[]): void => {},
		};

		// register 'stateChange' events; handle state changes one-by-one!
		this.mutex = new Mutex();
		this.on('stateChange', (stateId: string, stateChange: ioBroker.State | null | undefined) => {
			this.mutex.runExclusive(async () => {
				if (stateChange)	{ await this.onStateChange(stateId, stateChange); }
				else				{ this.logf.warn('%-15s %-15s %-10s %-40s', this.constructor.name, 'stateHandler()', 'deleted', this.ownId(stateId)); }
			});
		});

		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
	}

	/**
	 *
	 */
	protected async onReady(): Promise<void> {
		// unhandledRejection
		process.on('unhandledRejection', (reason: string, p: Promise<unknown>) => {
			this.log.error(`unhandledRejection ${reason} ${JSON.stringify(p, null, 4)} ${(new Error('')).stack}`);
		});

		// uncaughtException
		process.on('uncaughtException', (err, origin) => {
			this.log.error(`uncaughtException ${err}\n${origin}`);
		});

		// logf
		this.logf.silly		= (fmt: string, ...args) => this.log.silly(sprintf(		 fmt, ...args));
		this.logf.info		= (fmt: string, ...args) => this.log.info (sprintf(' ' + fmt, ...args));
		this.logf.debug		= (fmt: string, ...args) => this.log.debug(sprintf(      fmt, ...args));
		this.logf.warn		= (fmt: string, ...args) => this.log.warn (sprintf(' ' + fmt, ...args));
		this.logf.error		= (fmt: string, ...args) => this.log.error(sprintf(      fmt, ...args));
		this.logf.debug('%-15s %-15s', this.constructor.name, 'onReady()');

		// historyId
		const systemConfig	= await this.getForeignObjectAsync('system.config');
		this.historyId = systemConfig?.common.defaultHistory  ||  '';
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
		this.logf.debug('%-15s %-15s %-10s %-40s %-4s %s', this.constructor.name, 'subscribe()', (len === 1 ? 'first' : ''), stateId, ''+('val' in spec ? spec.val : '*'), ''+('ack' in spec ? (spec.ack ? 'ack' : 'cmd') : '*'));
		if (len === 1) {
			await this.subscribeForeignStatesAsync(stateId);
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
		this.logf.debug('%-15s %-15s %-10s %-40s %-4s %s', this.constructor.name, 'unsubscribe()', (specs.length === 0 ? 'last' : ''), stateId, ''+('val' in spec ? spec.val : '*'), ''+('ack' in spec ? (spec.ack ? 'ack' : 'cmd') : '*'));
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
		spec.cb = async (stateChange: ioBroker.State) => {
			await this.unsubscribe(spec);
			await cb(stateChange);
		};
		await this.subscribe(spec);
	}

	/**
	 *
	 * @param stateId
	 * @param stateChange
	 */
	private async onStateChange(stateId: string, stateChange: ioBroker.State): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s %s   %-3s %s', this.constructor.name, 'onStateChange()', '', this.ownId(stateId), this.dateStr(stateChange.ts), (stateChange.ack ? '' : 'cmd'), (typeof stateChange.val === 'boolean') ? (stateChange.val ? 'ON' : 'OFF') : Math.round(stateChange.val as number*1e6)/1e6);

		const specs = this.stateChangeSpecs[stateId];
		if (specs) {
			// call callback if opts do match
			for (const spec of specs) {
				const valMatch = ('val' in spec) ? (spec.val === stateChange.val) : true;
				const ackMatch = ('ack' in spec) ? (spec.ack === stateChange.ack) : true;
				if (valMatch  &&  ackMatch) {
					await spec.cb(stateChange);
				}
			}
		} else {
			this.logf.error('%-15s %-15s %-10s %-40s %s   %-3s %s', this.constructor.name, 'subscribe()', 'no stateChangeSpec', this.ownId(stateId), this.dateStr(stateChange.ts), (stateChange.ack ? '' : 'cmd'), (typeof stateChange.val === 'boolean') ? (stateChange.val ? 'ON' : 'OFF') : Math.round(stateChange.val as number*1e6)/1e6);
		}
	}

	/**
	 *
	 * @returns
	 */
	public ownId(objId: string): string {
		if (objId.startsWith(this.namespace))	{ return objId.slice(this.namespace.length + 1);	}
		else									{ return objId;										}
	}

	/**
	 *
	 * @param ts
	 * @returns
	 */
	public dateStr(ts: number = Date.now()): string {
		return new Date(ts).toLocaleString('de-DE');
	}
}
