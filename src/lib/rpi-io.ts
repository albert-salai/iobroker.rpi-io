import * as utils					from '@iobroker/adapter-core';
import { IoObject }					from './io-object';
import { IoAdapter }				from './io-adapter';

// ~~~~~~~~~
// IoAdapter
// ~~~~~~~~~
export class RpiIo extends IoAdapter {

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({...options, name: 'rpi-io' });
		this.on('ready',	this.onReady .bind(this));
		this.on('unload',	this.onUnload.bind(this));
	}

	/**
	 *
	 */
	protected override async onReady(): Promise<void> {
		this.setState('info.connection', false, true);
		try {
			await super.onReady();

			// FIXME
			//new IoDevice(`${this.namespace}.delme`, 'delme');

			// init
			await IoObject.onReady();

			// ready
			await this.setState('info.connection', true, true);

		} catch (e: unknown) {
			this.log.error(`${e}\n${(e instanceof Error) ? e.stack : JSON.stringify(e)}`);
			this.setState('info.connection', false, true);
		}
	}

	/**
	 *
	 * @param callback
	 */
	private async onUnload(callback: () => void): Promise<void> {
		try {
			await IoObject.onUnload();

		} catch (e: unknown) {
			this.log.error(`${e}\n${(e instanceof Error) ? e.stack : JSON.stringify(e)}`);

		} finally {
			callback();
		}
	}
}







/**
 * Is called if a subscribed state changes
 */
/*
private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
	if (state) {
		// The state was changed
		this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
	} else {
		// The state was deleted
		this.log.info(`state ${id} deleted`);
	}
}
*/


/*
For every state in the system there has to be also an object of type state
Here a simple template for a boolean variable named "testVariable"
Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
*/
/*
await this.setObjectNotExistsAsync('testVariable', {
	type: 'state',
	common: {
		name: 'testVariable',
		type: 'boolean',
		role: 'indicator',
		read: true,
		write: true,
	},
	native: {},
});
*/

// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
//this.subscribeStates('testVariable');
// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
// this.subscribeStates('lights.*');
// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
// this.subscribeStates('*');

/*
	setState examples
	you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
*/
// the variable testVariable is set to true as command (ack=false)
//await this.setStateAsync('testVariable', true);

// same thing, but the value is flagged "ack"
// ack should be always set to true if the value is received from or acknowledged from the target system
//await this.setStateAsync('testVariable', { val: true, ack: true });

// same thing, but the state is deleted after 30s (getState will return null afterwards)
//await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

// examples for the checkPassword/checkGroup functions
//let result = await this.checkPasswordAsync('admin', 'iobroker');
//this.log.info('check user admin pw iobroker: ' + result);

//result = await this.checkGroupAsync('admin', 'admin');
//this.log.info('check group user admin group admin: ' + result);

// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
// /**
//  * Is called if a subscribed object changes
//  */
// private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
// 	if (obj) {
// 		// The object was changed
// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
// 	} else {
// 		// The object was deleted
// 		this.log.info(`object ${id} deleted`);
// 	}
// }


// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
// /**
//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
//  */
// private onMessage(obj: ioBroker.Message): void {
// 	if (typeof obj === 'object' && obj.message) {
// 		if (obj.command === 'send') {
// 			// e.g. send email or pushover or whatever
// 			this.log.info('send command');

// 			// Send response in callback if required
// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
// 		}
// 	}
// }



