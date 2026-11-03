/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Consented Skill Recorder Tests (`src/packages/recorder/consented_recorder.test.ts`)
 * Verifies explicit user consent requirement, desktop driver integration,
 * sensitive screen auto-pause, secret redaction, frame deletion, and compilation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsentedSkillRecorder } from './consented_recorder';
import { createDesktopDriver } from '../pc_operator';

test('ConsentedSkillRecorder: requires explicit user consent before recording', async () => {
  const driver = createDesktopDriver('linux');
  const recorder = new ConsentedSkillRecorder({ driver });

  // Starting without consent must throw
  await assert.rejects(
    async () => {
      await recorder.startRecording();
    },
    /RECORDING_CONSENT_REQUIRED/
  );

  // Granting consent allows recording to start
  recorder.grantConsent({
    allowedApps: ['Editor', 'Terminal'],
    allowKeylogging: false,
    blurCredentials: true,
  });

  const session = await recorder.startRecording();
  assert.equal(session.state, 'RECORDING');
  assert.equal(session.consentGranted, true);
  await recorder.stopRecording();
});

test('ConsentedSkillRecorder: auto-pauses on credential or sensitive screens', async () => {
  const driver = createDesktopDriver('linux');
  const recorder = new ConsentedSkillRecorder({ driver });

  recorder.grantConsent({
    allowedApps: ['*'],
    allowKeylogging: false,
    blurCredentials: true,
  });

  await recorder.startRecording();

  // Simulate perception with a credential vault / 1Password window
  const paused = await recorder.recordKeyframeWithPerception({
    activeWindow: {
      title: '1Password — Unlock Vault',
      appName: '1Password',
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    },
    uiElements: [
      {
        id: 'pwd_input',
        name: 'Master Password',
        role: 'password_field',
        bounds: { x: 50, y: 100, width: 200, height: 30 },
      },
    ],
  });

  assert.equal(paused, true);
  const session = recorder.getSession();
  assert.equal(session?.state, 'PAUSED_ON_CREDENTIAL');

  await recorder.stopRecording();
});

test('ConsentedSkillRecorder: redacts secrets from typed interaction events', async () => {
  const driver = createDesktopDriver('linux');
  const recorder = new ConsentedSkillRecorder({ driver });

  recorder.grantConsent({
    allowedApps: ['*'],
    allowKeylogging: false,
    blurCredentials: true,
  });

  await recorder.startRecording();

  // Record safe interaction
  recorder.recordInteraction({
    type: 'type',
    targetDescriptor: 'search_bar',
    accessibleName: 'Search Documentation',
    value: 'react router hooks',
    urlOrApp: 'Browser',
    isCredentialField: false,
  });

  // Record sensitive interaction
  recorder.recordInteraction({
    type: 'type',
    targetDescriptor: 'api_token_field',
    accessibleName: 'API Secret Key',
    value: 'sk_live_very_secret_key_12345',
    urlOrApp: 'Settings',
    isCredentialField: true,
  });

  const session = recorder.getSession();
  assert.ok(session);
  assert.ok(session.interactions);
  assert.equal(session.interactions.length, 2);

  assert.equal(session.interactions[0].value, 'react router hooks');
  assert.equal(session.interactions[1].value, '[REDACTED_SECRET]');

  await recorder.stopRecording();
});

test('ConsentedSkillRecorder: supports frame deletion and compiles to parameterized skill', async () => {
  const driver = createDesktopDriver('linux');
  const recorder = new ConsentedSkillRecorder({ driver });

  recorder.grantConsent({ allowedApps: ['*'], allowKeylogging: false, blurCredentials: true });
  await recorder.startRecording();

  // Capture a couple frames
  await recorder.captureFrame();
  await recorder.captureFrame();

  recorder.recordInteraction({
    type: 'click',
    targetDescriptor: 'btn_submit',
    accessibleName: 'Submit Form',
    urlOrApp: 'WebApp',
  });

  const sessionBefore = recorder.getSession()!;
  assert.equal(sessionBefore.keyframes.length, 2);

  // User deletes the first frame during preview
  const frameToDeleteId = sessionBefore.keyframes[0].id;
  const deleted = recorder.deleteKeyframe(frameToDeleteId);
  assert.equal(deleted, true);

  const sessionAfter = recorder.getSession()!;
  assert.equal(sessionAfter.keyframes.filter((k) => !k.isDeleted).length, 1);

  // Stop recording and compile skill
  await recorder.stopRecording();
  const compiledSkill = recorder.compileToSkill('Submit Form Skill');

  assert.equal(compiledSkill.name, 'Submit Form Skill');
  assert.equal(compiledSkill.steps.length, 1);
  assert.equal(compiledSkill.steps[0].actionType, 'click');
  assert.equal(compiledSkill.steps[0].accessibleName, 'Submit Form');
  assert.ok(compiledSkill.steps[0].verifier);
});
