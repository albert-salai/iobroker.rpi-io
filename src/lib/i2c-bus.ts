// '@iobroker/types' (declaring global namespace 'ioBroker') is already imported
// see "SMBus Compatibility With an I2C Device" (Texas Instruments Application Report SLOA132–April 2009)
import { IoAdapter }							from './io-adapter';
import { openPromisified, PromisifiedBus }		from 'i2c-bus';
import { Mutex }								from 'async-mutex';
import { Buffer }								from 'node:buffer';

// ~~~~~~
// I2cBus
// ~~~~~~
export class I2cBus {
	private readonly	bus:		PromisifiedBus;
	private readonly	logf:		IoAdapter['logf'];
	private readonly	mutex:		Mutex;

	// open
	static async open(busNumber: number): Promise<I2cBus> {
		const bus = await openPromisified(busNumber);
		return new I2cBus(bus);
	}

	// CONSTRUCTOR
	public constructor(bus: PromisifiedBus) {
		this.logf	= IoAdapter.this.logf;
		this.bus	= bus;
		this.mutex	= new Mutex();
	}

	/**
	 *
	 * @param cb
	 * @returns
	 */
	public async runExclusive<T>(cb: () => Promise<T>, timeoutMs = 200): Promise<T> {
		const timeoutErr = new Error(`${this.constructor.name}: runExclusive(): timeout after ${String(timeoutMs)} ms`);

		return this.mutex.runExclusive(() => {
			return new Promise<T>((resolve, reject) => {
				// reject after timeout
				const timer = setTimeout(() => {
					this.logf.error('%-15s %-15s %-10s after %d ms', this.constructor.name, 'runExclusive()', 'timeout', timeoutMs);
					reject(timeoutErr);
				}, timeoutMs);

				// try to run callback
				cb()
					.then(resolve)
					.catch((err: unknown) => {
						const { errno, code, syscall } = err as { syscall: string, errno: number, code: string };
						this.logf.error('%-15s %-15s %-10s %s() error %d %s', this.constructor.name, 'runExclusive()', 'i2c-error', syscall, errno, code);
						reject(new Error(`${this.constructor.name}: runExclusive(): ${syscall} errno ${String(errno)} ${code}`));
					})
					.finally(() => {
						clearTimeout(timer);
					});
			});
		});
	}

	/**
	 * scan()
	 */
	public scan(): Promise<number[]> {
		const timeoutMs = 1000;
		return this.runExclusive(async () => {
			return (await this.bus.scan());
		}, timeoutMs);
	}

	/**
	 * close()
	 */
	public close(): Promise<void> {
		return this.runExclusive(async () => {
			return this.bus.close();
		});
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @param size
	 * @returns
	 */
	public readBlock(address: number, register: number, size: number): Promise<number[]> {
		return this.runExclusive(async () => {
			const  rxBuf = Buffer.alloc(size);			// default: filled with 0
			await  this.bus.readI2cBlock(address, register, rxBuf.length, rxBuf);
			return Array.from(rxBuf);
		});
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @param values
	 */
	public writeBlock(address: number, register: number, values: number[]): Promise<{ bytesWritten: number; buffer: Buffer }> {
		return this.runExclusive(async () => {
			const  txBuf = Buffer.from(values);
			return this.bus.writeI2cBlock(address, register, txBuf.length, txBuf);
		});
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @returns
	 */
	public async readByte(address: number, register: number): Promise<number | undefined> {
		const  rxBuf = await this.readBlock(address, register, 1);
		return rxBuf[0];
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @param value
	 */
	public writeByte(address: number, register: number, value: number): Promise<{ bytesWritten: number, buffer: Buffer }> {
		return this.writeBlock(address, register, [ value ]);
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @returns
	 */
	public async readWord(address: number, register: number): Promise<number> {
		const rxBuf = await this.readBlock(address, register, 2);							// lower byte sent first
		const byte0 = rxBuf[0];
		const byte1 = rxBuf[1];
		return (byte0 === undefined || byte1 === undefined) ? 0 : (byte1 << 8) | byte0;
	}

	/**
	 *
	 * @param address
	 * @param register
	 * @param value
	 */
	public writeWord(address: number, register: number, value: number): Promise<{ bytesWritten: number, buffer: Buffer }> {
		return this.writeBlock(address, register, [ (value & 0xFF), (value >> 8) ]);		// lower byte sent first
	}
};
