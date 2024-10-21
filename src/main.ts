import * as utils	from '@iobroker/adapter-core';
import { RpiIo }	from './lib/rpi-io';


if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new RpiIo(options);
} else {
	// otherwise start the instance directly
	(() => new RpiIo())();
}
