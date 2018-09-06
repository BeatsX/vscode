/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const bootstrap = require('./bootstrap');

bootstrap.enableASARSupport();

// Will be defined if we got forked from another node process
// In that case we override console.log/warn/error to be able
// to send loading issues to the main side for logging.
if (!!process.send && process.env.PIPE_LOGGING === 'true') {
	var MAX_LENGTH = 100000;

	// Prevent circular stringify and convert arguments to real array
	function safeToArray(args) {
		var seen = [];
		var res;
		var argsArray = [];

		// Massage some arguments with special treatment
		if (args.length) {
			for (var i = 0; i < args.length; i++) {

				// Any argument of type 'undefined' needs to be specially treated because
				// JSON.stringify will simply ignore those. We replace them with the string
				// 'undefined' which is not 100% right, but good enough to be logged to console
				if (typeof args[i] === 'undefined') {
					args[i] = 'undefined';
				}

				// Any argument that is an Error will be changed to be just the error stack/message
				// itself because currently cannot serialize the error over entirely.
				else if (args[i] instanceof Error) {
					var errorObj = args[i];
					if (errorObj.stack) {
						args[i] = errorObj.stack;
					} else {
						args[i] = errorObj.toString();
					}
				}

				argsArray.push(args[i]);
			}
		}

		// Add the stack trace as payload if we are told so. We remove the message and the 2 top frames
		// to start the stacktrace where the console message was being written
		if (process.env.VSCODE_LOG_STACK === 'true') {
			const stack = new Error().stack;
			argsArray.push({ __$stack: stack.split('\n').slice(3).join('\n') });
		}

		try {
			res = JSON.stringify(argsArray, function (key, value) {

				// Objects get special treatment to prevent circles
				if (isObject(value) || Array.isArray(value)) {
					if (seen.indexOf(value) !== -1) {
						return '[Circular]';
					}

					seen.push(value);
				}

				return value;
			});
		} catch (error) {
			return 'Output omitted for an object that cannot be inspected (' + error.toString() + ')';
		}

		if (res && res.length > MAX_LENGTH) {
			return 'Output omitted for a large object that exceeds the limits';
		}

		return res;
	}

	function safeSend(arg) {
		try {
			process.send(arg);
		} catch (error) {
			// Can happen if the parent channel is closed meanwhile
		}
	}

	function isObject(obj) {
		return typeof obj === 'object'
			&& obj !== null
			&& !Array.isArray(obj)
			&& !(obj instanceof RegExp)
			&& !(obj instanceof Date);
	}

	// Pass console logging to the outside so that we have it in the main side if told so
	if (process.env.VERBOSE_LOGGING === 'true') {
		console.log = function () { safeSend({ type: '__$console', severity: 'log', arguments: safeToArray(arguments) }); };
		console.info = function () { safeSend({ type: '__$console', severity: 'log', arguments: safeToArray(arguments) }); };
		console.warn = function () { safeSend({ type: '__$console', severity: 'warn', arguments: safeToArray(arguments) }); };
	} else {
		console.log = function () { /* ignore */ };
		console.warn = function () { /* ignore */ };
		console.info = function () { /* ignore */ };
	}

	console.error = function () { safeSend({ type: '__$console', severity: 'error', arguments: safeToArray(arguments) }); };
}

if (!process.env['VSCODE_ALLOW_IO']) {
	// Let stdout, stderr and stdin be no-op streams. This prevents an issue where we would get an EBADF
	// error when we are inside a forked process and this process tries to access those channels.
	var stream = require('stream');
	var writable = new stream.Writable({
		write: function () { /* No OP */ }
	});

	process.__defineGetter__('stdout', function () { return writable; });
	process.__defineGetter__('stderr', function () { return writable; });
	process.__defineGetter__('stdin', function () { return writable; });
}

if (!process.env['VSCODE_HANDLES_UNCAUGHT_ERRORS']) {

	// Handle uncaught exceptions
	process.on('uncaughtException', function (err) {
		console.error('Uncaught Exception: ', err);
	});

	// Handle unhandled promise rejections
	process.on('unhandledRejection', function (reason) {
		console.error('Unhandled Promise Rejection: ', reason);
	});
}

// Kill oneself if one's parent dies. Much drama.
if (process.env['VSCODE_PARENT_PID']) {
	const parentPid = Number(process.env['VSCODE_PARENT_PID']);

	if (typeof parentPid === 'number' && !isNaN(parentPid)) {
		setInterval(function () {
			try {
				process.kill(parentPid, 0); // throws an exception if the main process doesn't exist anymore.
			} catch (e) {
				process.exit();
			}
		}, 5000);
	}
}

const crashReporterOptionsRaw = process.env['CRASH_REPORTER_START_OPTIONS'];
if (typeof crashReporterOptionsRaw === 'string') {
	try {
		const crashReporterOptions = JSON.parse(crashReporterOptionsRaw);
		if (crashReporterOptions) {
			process.crashReporter.start(crashReporterOptions);
		}
	} catch (error) {
		console.error(error);
	}
}

// Workaround for Electron not installing a handler to ignore SIGPIPE
// (https://github.com/electron/electron/issues/13254)
process.on('SIGPIPE', () => {
	console.error(new Error('Unexpected SIGPIPE'));
});

require('./bootstrap-amd').bootstrap(process.env['AMD_ENTRYPOINT']);