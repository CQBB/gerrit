/**
 * @license
 * Copyright (C) 2017 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import '../../../test/common-test-setup-karma.js';
import './gr-copy-clipboard.js';
import {dom} from '@polymer/polymer/lib/legacy/polymer.dom.js';

const basicFixture = fixtureFromElement('gr-copy-clipboard');

suite('gr-copy-clipboard tests', () => {
  let element;

  setup(done => {
    element = basicFixture.instantiate();
    element.text = `git fetch http://gerrit@localhost:8080/a/test-project
        refs/changes/05/5/1 && git checkout FETCH_HEAD`;
    flushAsynchronousOperations();
    flush(done);
  });

  test('copy to clipboard', () => {
    const clipboardSpy = sinon.spy(element, '_copyToClipboard');
    const copyBtn = element.shadowRoot
        .querySelector('.copyToClipboard');
    MockInteractions.tap(copyBtn);
    assert.isTrue(clipboardSpy.called);
  });

  test('focusOnCopy', () => {
    element.focusOnCopy();
    assert.deepEqual(dom(element.root).activeElement,
        element.shadowRoot
            .querySelector('.copyToClipboard'));
  });

  test('_handleInputClick', () => {
    // iron-input as parent should never be hidden as copy won't work
    // on nested hidden elements
    const ironInputElement = element.shadowRoot.querySelector('iron-input');
    assert.notEqual(getComputedStyle(ironInputElement).display, 'none');

    const inputElement = element.shadowRoot.querySelector('input');
    MockInteractions.tap(inputElement);
    assert.equal(inputElement.selectionStart, 0);
    assert.equal(inputElement.selectionEnd, element.text.length - 1);
  });

  test('hideInput', () => {
    // iron-input as parent should never be hidden as copy won't work
    // on nested hidden elements
    const ironInputElement = element.shadowRoot.querySelector('iron-input');
    assert.notEqual(getComputedStyle(ironInputElement).display, 'none');

    assert.notEqual(getComputedStyle(element.$.input).display, 'none');
    element.hideInput = true;
    flushAsynchronousOperations();
    assert.equal(getComputedStyle(element.$.input).display, 'none');
  });

  test('stop events propagation', () => {
    const divParent = document.createElement('div');
    divParent.appendChild(element);
    const clickStub = sinon.stub();
    divParent.addEventListener('click', clickStub);
    element.stopPropagation = true;
    const copyBtn = element.shadowRoot.querySelector('.copyToClipboard');
    MockInteractions.tap(copyBtn);
    assert.isFalse(clickStub.called);
  });
});

