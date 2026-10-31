/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Connectors SDK & Everyday Scheduler
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CONNECTOR_MANIFESTS,
  testConnectorReal,
  invokeConnectorToolWithSafety,
  validateConnectorUrlAgainstSsrf,
  computeNextScheduleRun,
  formatFrequencyPlainWords,
  formatTime12h,
  evaluateSleepAndWake,
  parseNaturalLanguageSchedule,
  EverydayScheduleItem,
} from './index';

describe('Connectors SDK & Everyday Scheduler Pure Logic', () => {
  it('includes all 18 connectors with exact 3-step setup guides and risk classes', () => {
    assert.strictEqual(INITIAL_CONNECTOR_MANIFESTS.length, 18);

    for (const c of INITIAL_CONNECTOR_MANIFESTS) {
      assert.ok(c.id.startsWith('conn-'), `Connector ${c.id} should have conn- prefix`);
      assert.ok(c.name.length > 0, `Connector ${c.id} missing name`);
      assert.strictEqual(c.setupGuide.length, 3, `Connector ${c.id} must have exactly 3 setup guide steps`);
      assert.ok(c.tools.length > 0, `Connector ${c.id} must declare tools`);

      // Verify every tool has risk class 'read' or 'write'
      for (const t of c.tools) {
        assert.ok(t.risk === 'read' || t.risk === 'write', `Tool ${t.name} must declare 'read' or 'write'`);
      }
    }
  });

  it('honestly handles connection testing: never shows connected without successful test', async () => {
    const weatherConn = INITIAL_CONNECTOR_MANIFESTS.find((c) => c.id === 'conn-weather')!;
    assert.strictEqual(weatherConn.status, 'needs_setup');

    // Test connection
    const testResult = await testConnectorReal({ connector: weatherConn, mode: 'mock' });
    assert.strictEqual(testResult.ok, true);
    assert.strictEqual(testResult.status, 'connected');
    assert.ok(testResult.summary.includes('Open-Meteo'));

    // Token-based connector without credentials should stay in needs_setup
    const githubConn = INITIAL_CONNECTOR_MANIFESTS.find((c) => c.id === 'conn-github')!;
    const unconfiguredTest = await testConnectorReal({ connector: githubConn, mode: 'mock' });
    assert.strictEqual(unconfiguredTest.ok, false);
    assert.strictEqual(unconfiguredTest.status, 'needs_setup');
    assert.ok(unconfiguredTest.error?.includes('Missing credentials'));
  });

  it('runs read tools freely and blocks unapproved write tools per Rule Book', () => {
    const githubConn = INITIAL_CONNECTOR_MANIFESTS.find((c) => c.id === 'conn-github')!;

    // 1. Read tool runs freely
    const readRes = invokeConnectorToolWithSafety({
      connector: githubConn,
      toolName: 'github.list_repos',
      params: {},
      rules: [],
    });
    assert.strictEqual(readRes.ok, true);
    assert.strictEqual(readRes.status, 'executed');
    assert.strictEqual(readRes.risk, 'read');
    assert.strictEqual(readRes.recordedInLedger, true);

    // 2. Write tool without approval requires approval
    const writeWithoutApproval = invokeConnectorToolWithSafety({
      connector: githubConn,
      toolName: 'github.create_issue',
      params: { title: 'Test issue' },
      rules: [],
      operatorApproved: false,
    });
    assert.strictEqual(writeWithoutApproval.ok, false);
    assert.strictEqual(writeWithoutApproval.status, 'needs_approval');
    assert.strictEqual(writeWithoutApproval.risk, 'write');

    // 3. Write tool with operator approval executes
    const writeWithApproval = invokeConnectorToolWithSafety({
      connector: githubConn,
      toolName: 'github.create_issue',
      params: { title: 'Test issue' },
      rules: [],
      operatorApproved: true,
    });
    assert.strictEqual(writeWithApproval.ok, true);
    assert.strictEqual(writeWithApproval.status, 'executed');

    // 4. Rule Book block overrides everything
    const writeBlockedByRule = invokeConnectorToolWithSafety({
      connector: githubConn,
      toolName: 'github.create_issue',
      params: { title: 'Test issue' },
      rules: [
        {
          id: 'rule-block-github-writes',
          text: 'Block all GitHub writes',
          scope: 'Connector',
          targetName: 'GitHub',
          actionClass: 'write',
          enforcement: 'block',
          enabled: true,
          safetyFloor: false,
        },
      ],
      operatorApproved: true,
    });
    assert.strictEqual(writeBlockedByRule.ok, false);
    assert.strictEqual(writeBlockedByRule.status, 'blocked_by_rule');
  });

  it('protects against SSRF by blocking loopback, private ranges, and cloud metadata', () => {
    // Blocked hosts
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://127.0.0.1:8080/admin').allowed, false);
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://localhost:3000').allowed, false);
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://169.254.169.254/latest/meta-data').allowed, false);
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://metadata.google.internal/computeMetadata').allowed, false);
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://192.168.1.1/router').allowed, false);
    assert.strictEqual(validateConnectorUrlAgainstSsrf('http://10.0.0.5/secrets').allowed, false);

    // Allowed hosts
    assert.strictEqual(
      validateConnectorUrlAgainstSsrf('https://api.open-meteo.com/v1/forecast').allowed,
      true
    );
    assert.strictEqual(
      validateConnectorUrlAgainstSsrf('https://en.wikipedia.org/api/rest_v1/page/summary/Kyoto').allowed,
      true
    );
    assert.strictEqual(
      validateConnectorUrlAgainstSsrf('https://api.github.com/user').allowed,
      true
    );
  });

  it('computes next schedule runs in plain words and handles DST and weekday logic', () => {
    const fixedNow = new Date('2026-10-30T10:00:00'); // Friday at 10 AM

    // 1. Next weekday at 8:00 AM from Friday 10 AM should be Monday
    const weekdayRun = computeNextScheduleRun({
      frequency: 'weekdays',
      timeOfDay: '08:00',
      fromTime: fixedNow,
    });
    const runDate = new Date(weekdayRun.nextEpochMs);
    assert.strictEqual(runDate.getDay(), 1); // Monday
    assert.strictEqual(runDate.getHours(), 8);
    assert.strictEqual(runDate.getMinutes(), 0);
    assert.ok(weekdayRun.plainWords.includes('8:00 AM'));
    assert.strictEqual(weekdayRun.cronExpression, '0 8 * * 1-5');

    // 2. Friendly time formatting
    assert.strictEqual(formatTime12h('08:00'), '8:00 AM');
    assert.strictEqual(formatTime12h('17:30'), '5:30 PM');
    assert.strictEqual(formatTime12h('00:15'), '12:15 AM');

    // 3. Frequency plain words
    assert.strictEqual(formatFrequencyPlainWords('weekdays', '08:00'), 'Every weekday at 8:00 AM');
    assert.strictEqual(
      formatFrequencyPlainWords('weekly', '17:00', ['fri']),
      'Weekly on Fri at 5:00 PM'
    );
  });

  it('evaluates sleep & wake: handles missed runs according to policy and blocks unattended money actions', () => {
    const lastChecked = new Date('2026-10-30T07:00:00').getTime();
    const wakeTime = new Date('2026-10-30T09:30:00').getTime(); // Slept 2.5 hours

    const testSchedules: EverydayScheduleItem[] = [
      {
        id: 'task-briefing',
        title: 'Morning Briefing',
        prompt: 'Summarize news and weather',
        frequency: 'every_day',
        timeOfDay: '08:00',
        mode: 'do_for_me',
        channel: 'toast',
        missedRunPolicy: 'run_when_back',
        enabled: true,
        nextRunLocal: 'Today, 8:00 AM',
        nextRunEpochMs: new Date('2026-10-30T08:00:00').getTime(),
        requiresMoneyOrSensitive: false,
      },
      {
        id: 'task-clean',
        title: 'Skip Task',
        prompt: 'Check logs',
        frequency: 'every_day',
        timeOfDay: '08:15',
        mode: 'do_for_me',
        channel: 'toast',
        missedRunPolicy: 'skip',
        enabled: true,
        nextRunLocal: 'Today, 8:15 AM',
        nextRunEpochMs: new Date('2026-10-30T08:15:00').getTime(),
        requiresMoneyOrSensitive: false,
      },
      {
        id: 'task-sensitive',
        title: 'Sensitive Bill Draft',
        prompt: 'Draft electricity payment',
        frequency: 'every_day',
        timeOfDay: '08:30',
        mode: 'do_for_me',
        channel: 'toast',
        missedRunPolicy: 'run_when_back',
        enabled: true,
        nextRunLocal: 'Today, 8:30 AM',
        nextRunEpochMs: new Date('2026-10-30T08:30:00').getTime(),
        requiresMoneyOrSensitive: true, // Sensitive money action!
      },
    ];

    const result = evaluateSleepAndWake({
      lastCheckedEpochMs: lastChecked,
      nowEpochMs: wakeTime,
      schedules: testSchedules,
    });

    assert.strictEqual(result.detectedWakeFromSleep, true);
    assert.strictEqual(result.sleptDurationMinutes, 150);
    assert.strictEqual(result.missedTasks.length, 3);

    // task-briefing: executed_now because run_when_back and non-sensitive
    assert.strictEqual(result.missedTasks[0].actionTaken, 'executed_now');

    // task-clean: skipped because policy was 'skip'
    assert.strictEqual(result.missedTasks[1].actionTaken, 'skipped');

    // task-sensitive: queued_for_approval because sensitive actions NEVER run unattended!
    assert.strictEqual(result.missedTasks[2].actionTaken, 'queued_for_approval');
  });

  it('parses natural language schedule strings into structured intents', () => {
    const parse1 = parseNaturalLanguageSchedule('every morning at 8');
    assert.strictEqual(parse1.matched, true);
    assert.strictEqual(parse1.timeOfDay, '08:00');

    const parse2 = parseNaturalLanguageSchedule('every weekday at 9am');
    assert.strictEqual(parse2.matched, true);
    assert.strictEqual(parse2.frequency, 'weekdays');
    assert.strictEqual(parse2.timeOfDay, '09:00');

    const parse3 = parseNaturalLanguageSchedule('every friday at 5:30 pm');
    assert.strictEqual(parse3.matched, true);
    assert.strictEqual(parse3.frequency, 'weekly');
    assert.deepStrictEqual(parse3.daysOfWeek, ['fri']);
    assert.strictEqual(parse3.timeOfDay, '17:30');
  });
});
