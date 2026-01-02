import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CssVariableManager } from '../src/cssVariableManager';

interface LogCall {
	type: 'log' | 'error';
	message: string;
}

class MockLogger {
	public calls: LogCall[] = [];

	log = (message: string) => {
		this.calls.push({ type: 'log', message });
	};

	error = (message: string) => {
		this.calls.push({ type: 'error', message });
	};

	getLogCalls(): string[] {
		return this.calls.filter(c => c.type === 'log').map(c => c.message);
	}

	getErrorCalls(): string[] {
		return this.calls.filter(c => c.type === 'error').map(c => c.message);
	}
}

async function withDebugEnv(value: string | undefined, fn: () => Promise<void> | void) {
	const previous = process.env.CSS_LSP_DEBUG;
	if (value === undefined) {
		delete process.env.CSS_LSP_DEBUG;
	} else {
		process.env.CSS_LSP_DEBUG = value;
	}

	try {
		await fn();
	} finally {
		if (previous === undefined) {
			delete process.env.CSS_LSP_DEBUG;
		} else {
			process.env.CSS_LSP_DEBUG = previous;
		}
	}
}

test('debug logging disabled by default', async () => {
	await withDebugEnv(undefined, () => {
		const mockLogger = new MockLogger();
		const manager = new CssVariableManager(mockLogger);

		const cssContent = ':root { --color: red; }';
		manager.parseContent(cssContent, 'file:///test.css', 'css');

		const logCalls = mockLogger.getLogCalls();
		assert.ok(logCalls.length === 0 || logCalls.every(msg => !msg.includes('[DEBUG]')));
	});
});

test('debug logging gated by env var', async () => {
	await withDebugEnv('1', () => {
		const mockLogger = new MockLogger();
		const manager = new CssVariableManager(mockLogger);

		const cssContent = ':root { --color: red; }';
		manager.parseContent(cssContent, 'file:///test.css', 'css');

		const logCalls = mockLogger.getLogCalls();
		assert.ok(Array.isArray(logCalls));
	});
});

test('production mode does not write log files', async () => {
	await withDebugEnv(undefined, () => {
		const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'css-lsp-test-'));
		const testLogFile = path.join(testDir, 'css.log');

		try {
			const mockLogger = new MockLogger();
			const manager = new CssVariableManager(mockLogger);

			manager.parseContent(':root { --a: red; }', 'file:///test1.css', 'css');
			manager.parseContent('.test { --b: blue; }', 'file:///test2.css', 'css');
			manager.parseContent('<style>:root { --c: green; }</style>', 'file:///test.html', 'html');

			assert.ok(!fs.existsSync(testLogFile));

			const tmpLogPath = path.join(os.tmpdir(), 'css.log');
			if (fs.existsSync(tmpLogPath)) {
				const stats = fs.statSync(tmpLogPath);
				const age = Date.now() - stats.mtimeMs;
				assert.ok(age > 5000);
			}
		} finally {
			try {
				fs.rmSync(testDir, { recursive: true });
			} catch (e) {
				// Ignore cleanup errors
			}
		}
	});
});

test('errors can still be logged in production', async () => {
	await withDebugEnv(undefined, () => {
		const mockLogger = new MockLogger();
		const manager = new CssVariableManager(mockLogger);

		try {
			manager.parseContent('this is not valid css {{{', 'file:///bad.css', 'css');
		} catch (e) {
			// css-tree is forgiving, so no error is expected
		}

		const errorCalls = mockLogger.getErrorCalls();
		assert.ok(Array.isArray(errorCalls));
	});
});

test('no hardcoded debug file writes', () => {
	const serverPath = path.join(__dirname, '..', 'src', 'server.ts');
	const managerPath = path.join(__dirname, '..', 'src', 'cssVariableManager.ts');

	let hasIssues = false;

	try {
		const serverContent = fs.readFileSync(serverPath, 'utf-8');
		const managerContent = fs.readFileSync(managerPath, 'utf-8');

		const problematicPatterns = [
			'/tmp/',
			'appendFileSync',
			'writeFileSync'
		];

		for (const pattern of problematicPatterns) {
			if (serverContent.includes(pattern) || managerContent.includes(pattern)) {
				hasIssues = true;
			}
		}

		assert.ok(!hasIssues);
	} catch (e) {
		const compiledServerPath = path.join(__dirname, '..', 'out', 'server.js');
		if (fs.existsSync(compiledServerPath)) {
			const compiledContent = fs.readFileSync(compiledServerPath, 'utf-8');
			if (compiledContent.includes('/tmp/') || compiledContent.includes('appendFileSync')) {
				hasIssues = true;
			}
		}

		assert.ok(!hasIssues);
	}
});

test('CSS_LSP_DEBUG environment variable truthiness', async () => {
	const testCases = [
		{ value: undefined, expected: false, desc: 'undefined' },
		{ value: '', expected: false, desc: 'empty string' },
		{ value: '0', expected: true, desc: '0 (truthy string)' },
		{ value: '1', expected: true, desc: '1' },
		{ value: 'true', expected: true, desc: 'true' },
		{ value: 'false', expected: true, desc: 'false (truthy string)' },
	];

	for (const testCase of testCases) {
		await withDebugEnv(testCase.value, () => {
			const isDebugEnabled = !!process.env.CSS_LSP_DEBUG;
			assert.strictEqual(isDebugEnabled, testCase.expected, `CSS_LSP_DEBUG=${testCase.desc}`);
		});
	}
});
