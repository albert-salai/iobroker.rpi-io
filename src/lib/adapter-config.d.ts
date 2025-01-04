// This file extends the AdapterConfig type from '@types/iobroker'

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			// GENERAL
			'I2cBusNb':			number,

			// GPIO
			'GpioDebounceMs':	number,
			'GpioInput': {
				gpioNum:		number,
				state:			string,
				name:			string,
				role:			string,
				inverted:		boolean,
				pollSecs:		number,
				history:		boolean,
			}[],
			'GpioOutput': {
				gpioNum:		number,
				state:			string,
				name:			string,
				role:			string,
				inverted:		boolean,
				default:		boolean,
				autoOffSecs:	number,
				history:		boolean,
			}[],

			// MCP23017
			'McpIntStateId':	string,
			'McpResetStateId':	string,
			'McpPollSecs':		number,
			'McpInput': {
				mcpPin:			'A0'|'A1'|'A2'|'A3'|'A4'|'A5'|'A6'|'A7'|'B0'|'B1'|'B2'|'B3'|'B4'|'B5'|'B6'|'B7',
				state:			string,
				name:			string,
				role:			string,
				inverted:		boolean,
				history:		boolean,
			}[],
			'McpOutput': {
				mcpPin:			'A0'|'A1'|'A2'|'A3'|'A4'|'A5'|'A6'|'A7'|'B0'|'B1'|'B2'|'B3'|'B4'|'B5'|'B6'|'B7',
				state:			string,
				name:			string,
				role:			string,
				inverted:		boolean,
				default:		boolean,
				autoOffSecs:	number,
				history:		boolean,
			}[]
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
