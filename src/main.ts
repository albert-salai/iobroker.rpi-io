import { AdapterOptions }	from '@iobroker/adapter-core';
import { RpiIo }			from './lib/rpi-io';


if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<AdapterOptions> | undefined) => new RpiIo(options);
} else {
	// otherwise start the instance directly
	(() => new RpiIo())();
}
