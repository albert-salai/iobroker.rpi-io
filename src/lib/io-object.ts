import { IoAdapter }		from './io-adapter';


// IoStateValue
interface IoStateValue {
	val:		ioBroker.StateValue,
	ts:			number
};

// IoStateObjConfig
interface IoStateObjConfig {
	common: {
		type:			ioBroker.CommonType,
		name:			string,
		role:			string,
		write:			boolean,
		def?:			boolean | number,
		unit?:			string,
	},
	native?:			Record<string, unknown>,
}


// ~~~~~~~~
// IoObject
// ~~~~~~~~
export class IoObject {
	protected			readonly	adapter						= IoAdapter.self;
	protected			readonly	logf						= IoAdapter.self.logf;
	protected static	readonly	allObjects: IoObject[]		= [];
	protected  			readonly	objId:		string;

	/**
	 *
	 * @param objId
	 */
	constructor(objId: string) {
		this.objId = objId;

		if (IoObject.find(objId)) {
			throw new Error(`IoState: constructor(): ${objId} already created`);
		}

		IoObject.allObjects.push(this);

		// logging is done in IoObject's constructor()
		this.logf.debug('%-15s %-15s %-10s %-40s', this.constructor.name, 'constructor()', 'new', this.ownId());
	}

	/**
	 *
	 */
	public static async onReady(): Promise<void> {
		IoAdapter.self.logf.debug('%-15s %-15s %-10s %-40s', this.name, 'onReady()', 'init', 'allObjects ...');
		for (const ioObj of IoObject.allObjects) {
			await  ioObj.onReady();
		}
	}

	/**
	 *
	 * @returns
	 */
	protected async onReady(): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s', this.constructor.name, 'onReady()', 'object', this.ownId());
	}

	/**
	 *
	 */
	public static async onUnload(): Promise<void> {
		IoAdapter.self.logf.debug('%-15s %-15s %-10s #%d', this.name, 'onUnload()', 'objects', IoObject.allObjects.length);
		for (const ioObj of IoObject.allObjects) {
			await  ioObj.onUnload();
		}
	}

	/**
	 *
	 */
	public async onUnload(): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s', this.constructor.name, 'onUnload()', 'object', this.ownId());
	}

	/**
	 *
	 * @param id
	 * @returns
	 */
	public static find(objId: string): IoObject | undefined {
		return IoObject.allObjects.find((obj) => (obj.objId === objId));
	}

	/**
	 *
	 * @returns
	 */
	public ownId(): string {
		return this.adapter.ownId(this.objId);
	}

	/**
	 *
	 * @param ts
	 * @returns
	 */
	public dateStr(ts: number = Date.now()): string {
		return this.adapter.dateStr(ts);
	}
};




// ~~~~~~~~
// IoFolder
// ~~~~~~~~
export class IoFolder extends IoObject {
	protected common:	ioBroker.SettableFolderObject['common'] = { 'name': '' };

	/**
	 *
	 * @param folderId
	 * @param folderName
	 */
	constructor(folderId: string, folderName: string) {
		super(folderId);
		this.common.name = folderName
	}

	/**
	 *
	 */
	protected override async onReady(): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s %s', this.constructor.name, 'onReady()', 'init', this.ownId(), ''+this.common?.name);

		// create folder object before calling super.init()
		const obj: ioBroker.SettableFolderObject = {
			'type':			'folder',
			'common':		this.common,
			'native':		{}
		};
		await this.adapter.setForeignObjectAsync(this.objId, obj);

		// call super.init() after folder object has been created
		await super.onReady();
	}
}




// ~~~~~~~~
// IoDevice
// ~~~~~~~~
export class IoDevice extends IoObject {
	protected common:	ioBroker.SettableDeviceObject['common'] = { 'name': '' };

	/**
	 *
	 * @param deviceId
	 * @param deviceName
	 */
	constructor(deviceId: string, deviceName: string) {
		super(deviceId);
		this.common.name = deviceName;
	}

	/**
	 *
	 */
	public override async onReady(): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s %s', this.constructor.name, 'onReady()', 'init', this.ownId(), ''+this.common?.name);

		// create device object before calling super.init()
		const obj: ioBroker.SettableDeviceObject = {
			'type':			'device',
			'common':		this.common,
			'native':		{}
		};
		await this.adapter.setForeignObjectAsync(this.objId, obj);

		// call super.init() after device object has been created
		await super.onReady();
	}
}



// ~~~~~~~~~
// IoChannel
// ~~~~~~~~~
export class IoChannel extends IoObject {
	protected common:	ioBroker.SettableChannelObject['common'] = { 'name': '' };

	/**
	 *
	 * @param channelId
	 * @param channelName
	 */
	constructor(channelId: string, channelName: string) {
		super(channelId);
		this.common.name = channelName;
	}

	/**
	 *
	 */
	public override async onReady(): Promise<void> {
		this.logf.debug('%-15s %-15s %-10s %-40s %s', this.constructor.name, 'onReady()', 'init', this.ownId(), ''+this.common?.name);

		// create channel object before calling super.init()
		const obj: ioBroker.SettableChannelObject = {
			'type':			'channel',
			'common':		this.common,
			'native':		{}
		};
		await this.adapter.setForeignObjectAsync(this.objId, obj);

		// call super.init() after channel object has been created
		await super.onReady();
	}
}


// ~~~~~~~
// IoState
// ~~~~~~~
export class IoState extends IoObject {
	public readonly native: Record<string, unknown> = {};
	public readonly common: ioBroker.StateCommon = {
		name:		'',
		role:		'',
		type:		'mixed',
		read:		true,
		write:		false,
		defAck:		true
	};

	public readonly	last:		IoStateValue	= { val: false, ts: 0 };
	public readonly	curr:		IoStateValue	= { val: false, ts: 0 };

	private logAck			= false;		// by default don't log ack
	private logCmd			= false;		// by default don't log cmd
	private logUnchanged	= false;		// by default don't log unchanged val

	/**
	 *
	 */
	protected override async onReady(): Promise<void> {
		// read common, native
		const obj = await this.adapter.getForeignObjectAsync(this.objId);
		if (! obj  ||  obj.type !== 'state') {
			throw new Error(`${this.constructor.name}: onReady(): missing object ${this.objId}}`);
		}
		Object.assign(this.common, obj.common);
		Object.assign(this.native, obj.native);

		// default logging
		this.logAck = (! this.common.write);		// log ack if readonly
		this.logCmd = (  this.common.write);		// log cmd if writable

		// read state
		const state = await this.adapter.getForeignStateAsync(this.objId);
		if (! state) {
			this.logf.error('%-15s %-15s %-10s %-40s %s', this.constructor.name, 'onReady()', 'error', this.objId, 'state unset');

		} else {
			// init last/curr val/ack/ts
			const { val, ack, ts } = state;
			if (ack)	{ this.logf.debug('%-15s %-15s %-10s %-40s %s   %-3s %s', this.constructor.name, 'onReady()', 'init', this.ownId(), this.dateStr(ts), '',    (typeof val === 'boolean') ? (val ? 'ON' : 'OFF') : Math.round(val as number*1e6)/1e6);	}
			else		{ this.logf.warn ('%-15s %-15s %-10s %-40s %s   %-3s %s', this.constructor.name, 'onReady()', 'init', this.ownId(), this.dateStr(ts), 'cmd', (typeof val === 'boolean') ? (val ? 'ON' : 'OFF') : Math.round(val as number*1e6)/1e6);	}
			this.initVal(val, ts);
		}

		await this.adapter.subscribe({ 'stateId': this.objId, 'cb': async (stateChange: ioBroker.State) => {
			const valChanged = (stateChange.val !== this.curr.val);

			// debug log (must be first subscription for this state)
			const logChanged = (stateChange.ack ? this.logAck : this.logCmd);
			const doLog = (valChanged) ? logChanged : this.logUnchanged;
			if (doLog) {
				this.logf.debug('%-15s %-15s %-10s %-40s %s   %-3s %s', this.constructor.name, 'log()', (valChanged ? 'changed' : 'unchanged'), this.ownId(), this.adapter.dateStr(stateChange.ts), (stateChange.ack ? '' : 'cmd'), (typeof stateChange.val === 'boolean') ? (stateChange.val ? 'ON' : 'OFF') : Math.round(stateChange.val as number*1e6)/1e6);
			}

			// process acknowledged val state changes
			if (valChanged  &&  stateChange.ack) {								// val changed?
				await this.setAckVal(stateChange.val, stateChange.ts);			// set new val and call operators
			}
		}});
	}

	/**
	 *
	 * @param val
	 * @param ack
	 */
	public async write(val: ioBroker.StateValue, ack: boolean = true): Promise<void> {			// must be called from Operator execute()
		const ts = Date.now();
		await this.adapter.setForeignStateAsync(this.objId, { val, ack, ts });
	}

	/**
	 *
	 * @param val
	 * @param ts
	 */
	public initVal(val: ioBroker.StateValue, ts: number): void {			// also called vom history
		this.curr.val = this.last.val = val;
		this.curr.ts  = this.last.ts  = ts;
	}

	/**
	 *
	 * @param val
	 * @param ts
	 */
	public async setAckVal(val: ioBroker.StateValue, ts: number): Promise<void> {				// also called vom history
		// set val, ack, ts
		Object.assign(this.last,   this.curr				);
		Object.assign(this.curr, { val, 'ack': true, ts }	);
	}

	/**
	 *
	 * @param opts
	 */
	public setLog(opts: { ack?: boolean, cmd?: boolean, unchanged?: boolean }): void {
		if (opts.ack		!== undefined)	{ this.logAck		= opts.ack;			}
		if (opts.cmd		!== undefined)	{ this.logCmd		= opts.cmd;			}
		if (opts.unchanged	!== undefined)	{ this.logUnchanged	= opts.unchanged;	}
	}

	/**
	 *
	 * @param id
	 * @returns
	 */
	public static get(id: string): IoState | undefined {
		let ioObj = IoObject.find(id);
		if (ioObj instanceof IoState) {
			return ioObj;

		} else {
			ioObj = IoObject.find(`${IoAdapter.self.namespace}.${id}`);
			if (ioObj instanceof IoState) {
				return ioObj;
			} else {
				return undefined;
			}
		}
	}
};


// ~~~~~~~~~~
// IoOwnState
// ~~~~~~~~~~
export class IoOwnState extends IoState {
	/**
	 *
	 * @param stateId
	 * @param pinConfig
	 */
	public constructor(stateId: string, objConfig: IoStateObjConfig) {
		super(stateId);
		Object.assign(this.common, objConfig.common);
		Object.assign(this.native, objConfig.native  ||  {});
	}

	/**
	 *
	 */
	public override async onReady(): Promise<void> {
		// create state object before calling super.init()
		const stateObj: ioBroker.SettableStateObject = {
			'type':			'state',
			'common':		this.common,
			'native':		this.native,
		};
		await this.adapter.setForeignObjectAsync(this.objId, stateObj);

		// call super.init() after state object has been created
		await super.onReady();

		// set history defaults
		if (this.adapter.historyId) {
			const common = this.common;
			const custom = common.custom;
			if (custom) {
				const storageType = (common.type[0] || '').toUpperCase() + common.type.slice(1);
				const history = custom[this.adapter.historyId];
				if (history  &&  history.storageType !== storageType) {
					history.storageType   = storageType;
					await this.adapter.setForeignObjectAsync(this.objId, {
						'type':			'state',
						'common':		this.common,
						'native':		this.native
					});
				}
			}
		}

		// acknowledge pending IoOwnState cmd
		const state = await this.adapter.getForeignStateAsync(this.objId);
		if (state  &&  ! state.ack) {
			await this.adapter.setForeignStateAsync(this.objId, { 'val': state.val, 'ack': true});
		}
	}
};
