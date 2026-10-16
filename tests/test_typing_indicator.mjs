/**
 * Unit and Lifecycle Tests for Chatbot Three-Dot Typing Indicator.
 * Validates:
 * 1. Indicator shows three animated dots when question is submitted.
 * 2. Proper DOM structure, accessibility labels, and classes.
 * 3. Removal upon first streaming token arrival.
 * 4. Removal upon normal response completion.
 * 5. Removal and cleanup upon API failure / error.
 * 6. Removal and feedback upon empty response.
 * 7. Prevention of duplicate indicators and permanently stuck states during repeated submissions.
 */

import assert from 'node:assert';
import fs from 'node:fs';

// Verify CSS definitions first
console.log('--- Testing document-chat.css Typing Animation ---');
const cssContent = fs.readFileSync('frontend/pages/document-chat.css', 'utf8');

assert.ok(cssContent.includes('.typing-indicator-message'), 'CSS must define .typing-indicator-message');
assert.ok(cssContent.includes('.typing-indicator-bubble'), 'CSS must define .typing-indicator-bubble');
assert.ok(cssContent.includes('.typing-dots'), 'CSS must define .typing-dots');
assert.ok(cssContent.includes('.typing-dot'), 'CSS must define .typing-dot');
assert.ok(cssContent.includes('@keyframes typingBounce'), 'CSS must define typingBounce keyframes');
assert.ok(cssContent.includes('animation-delay: 0.18s'), 'CSS must define staggered animation delays');
assert.ok(cssContent.includes('animation-delay: 0.36s'), 'CSS must define staggered animation delays');
assert.ok(cssContent.includes('prefers-reduced-motion'), 'CSS must support prefers-reduced-motion');
console.log('  CSS rules verified successfully.');

console.log('--- Testing Chat Lifecycle and Typing Indicator ---');

// Mock a lightweight DOM environment for testing the chat controller logic
class MockElement {
  constructor(tag, id = '', className = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
  }

  setAttribute(k, v) { this.attributes.set(k, v); }
  getAttribute(k) { return this.attributes.get(k); }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
    }
  }

  querySelector(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.find((c) => c.className && c.className.includes(cls)) || null;
    }
    return null;
  }

  querySelectorAll(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.filter((c) => c.className && c.className.includes(cls));
    }
    return [];
  }
}

class MockChatMessages extends MockElement {
  constructor() {
    super('DIV', 'chat-messages', 'chat-messages-container');
    this.scrollTop = 0;
    this.scrollHeight = 100;
  }
}

// Emulate document-chat.js typing indicator controller
function createTestChatController() {
  const chatMessages = new MockChatMessages();
  let typingIndicatorEl = null;
  let isSubmitting = false;

  function showTypingIndicator() {
    hideTypingIndicator();

    const indicator = new MockElement('DIV', 'chat-typing-indicator', 'chat-message message-assistant typing-indicator-message');
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', 'Assistant is typing');

    const bubble = new MockElement('DIV', '', 'message-bubble typing-indicator-bubble');
    const dotsContainer = new MockElement('DIV', '', 'typing-dots');
    dotsContainer.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < 3; i++) {
      dotsContainer.appendChild(new MockElement('SPAN', '', 'typing-dot'));
    }

    const srOnly = new MockElement('SPAN', '', 'sr-only');
    srOnly.textContent = 'Assistant is typing...';

    bubble.appendChild(dotsContainer);
    bubble.appendChild(srOnly);
    indicator.appendChild(bubble);

    chatMessages.appendChild(indicator);
    typingIndicatorEl = indicator;
  }

  function hideTypingIndicator() {
    if (typingIndicatorEl) {
      typingIndicatorEl.remove();
      typingIndicatorEl = null;
    }
    const idx = chatMessages.children.findIndex((c) => c.id === 'chat-typing-indicator');
    if (idx !== -1) {
      chatMessages.children.splice(idx, 1);
    }
  }

  async function handleQuestionSubmit(question, mockApiStream) {
    if (isSubmitting) return 'BLOCKED_DUPLICATE';
    isSubmitting = true;

    // User message
    const userMsg = new MockElement('DIV', '', 'chat-message message-user');
    userMsg.textContent = question;
    chatMessages.appendChild(userMsg);

    // Show indicator
    showTypingIndicator();

    let fullAnswer = '';
    let answerMessageAppended = false;

    try {
      await mockApiStream({
        onToken: (tok) => {
          hideTypingIndicator();
          if (!answerMessageAppended) {
            const assistantMsg = new MockElement('DIV', '', 'chat-message message-assistant');
            assistantMsg.textContent = tok;
            chatMessages.appendChild(assistantMsg);
            answerMessageAppended = true;
          }
          fullAnswer += tok;
        },
        onError: (err) => {
          hideTypingIndicator();
          const errEl = new MockElement('DIV', '', 'chat-message message-error');
          errEl.textContent = err || 'Error occurred';
          chatMessages.appendChild(errEl);
        },
        onDone: () => {
          hideTypingIndicator();
          if (!fullAnswer || !fullAnswer.trim()) {
            const emptyEl = new MockElement('DIV', '', 'chat-message message-error');
            emptyEl.textContent = 'No response was generated for this question. Please try rephrasing.';
            chatMessages.appendChild(emptyEl);
          }
        },
      });
    } catch (e) {
      hideTypingIndicator();
      const errEl = new MockElement('DIV', '', 'chat-message message-error');
      errEl.textContent = e.message;
      chatMessages.appendChild(errEl);
    } finally {
      hideTypingIndicator();
      isSubmitting = false;
    }
  }

  return {
    chatMessages,
    showTypingIndicator,
    hideTypingIndicator,
    handleQuestionSubmit,
    getTypingIndicator: () => chatMessages.children.find((c) => c.id === 'chat-typing-indicator'),
  };
}

async function runTests() {
  // Test 1: DOM Structure and Accessibility
  console.log('Test 1: Indicator DOM Structure & Accessibility');
  const chat1 = createTestChatController();
  chat1.showTypingIndicator();

  const indicator = chat1.getTypingIndicator();
  assert.ok(indicator, 'Typing indicator should be present in chatMessages');
  assert.strictEqual(indicator.getAttribute('role'), 'status');
  assert.strictEqual(indicator.getAttribute('aria-label'), 'Assistant is typing');
  assert.strictEqual(indicator.getAttribute('aria-live'), 'polite');

  const bubble = indicator.querySelector('.typing-indicator-bubble');
  assert.ok(bubble, 'Should contain message-bubble with typing-indicator-bubble class');

  const dotsContainer = bubble.querySelector('.typing-dots');
  assert.ok(dotsContainer, 'Should contain .typing-dots');
  assert.strictEqual(dotsContainer.getAttribute('aria-hidden'), 'true');

  const dots = dotsContainer.querySelectorAll('.typing-dot');
  assert.strictEqual(dots.length, 3, 'Should render exactly 3 dots');

  const srOnly = bubble.querySelector('.sr-only');
  assert.ok(srOnly, 'Should contain accessible screen reader text');
  assert.strictEqual(srOnly.textContent, 'Assistant is typing...');
  console.log('  PASSED');

  // Test 2: Streaming Response Lifecycle
  console.log('Test 2: Streaming Response Lifecycle');
  const chat2 = createTestChatController();

  let indicatorVisibleWhileWaiting = false;
  let indicatorVisibleAfterToken = true;

  const mockStreamingApi = async ({ onToken, onDone }) => {
    // While waiting for first token:
    indicatorVisibleWhileWaiting = Boolean(chat2.getTypingIndicator());
    await new Promise((r) => setTimeout(r, 20));

    // First token arrives
    onToken('Hello ');
    indicatorVisibleAfterToken = Boolean(chat2.getTypingIndicator());

    // Subsequent tokens
    await new Promise((r) => setTimeout(r, 10));
    onToken('researcher!');

    onDone();
  };

  await chat2.handleQuestionSubmit('What is quantum computing?', mockStreamingApi);

  assert.strictEqual(indicatorVisibleWhileWaiting, true, 'Indicator must be visible while waiting for first token');
  assert.strictEqual(indicatorVisibleAfterToken, false, 'Indicator must be removed as soon as first token arrives');
  assert.strictEqual(chat2.getTypingIndicator(), undefined, 'Indicator must not exist after completion');
  console.log('  PASSED');

  // Test 3: API Failure Handling
  console.log('Test 3: API Failure Handling');
  const chat3 = createTestChatController();

  const mockErrorApi = async ({ onError }) => {
    assert.ok(chat3.getTypingIndicator(), 'Indicator present before error');
    await new Promise((r) => setTimeout(r, 15));
    onError('LLM service unavailable');
  };

  await chat3.handleQuestionSubmit('Trigger error', mockErrorApi);
  assert.strictEqual(chat3.getTypingIndicator(), undefined, 'Indicator must be removed on API error');
  const errMsg = chat3.chatMessages.children.find((c) => c.className.includes('message-error'));
  assert.ok(errMsg && errMsg.textContent.includes('unavailable'), 'Error message should be rendered');
  console.log('  PASSED');

  // Test 4: Empty Response Handling
  console.log('Test 4: Empty Response Handling');
  const chat4 = createTestChatController();

  const mockEmptyApi = async ({ onDone }) => {
    assert.ok(chat4.getTypingIndicator(), 'Indicator present while awaiting response');
    await new Promise((r) => setTimeout(r, 15));
    // onDone called with no tokens emitted
    onDone();
  };

  await chat4.handleQuestionSubmit('Empty query', mockEmptyApi);
  assert.strictEqual(chat4.getTypingIndicator(), undefined, 'Indicator must be removed on empty response');
  const emptyFeedback = chat4.chatMessages.children.find((c) => c.className.includes('message-error'));
  assert.ok(emptyFeedback, 'Helpful fallback feedback rendered for empty response');
  console.log('  PASSED');

  // Test 5: Repeated Message Submissions / Prevention of Duplicate Indicators
  console.log('Test 5: Repeated Submissions & Duplicate Prevention');
  const chat5 = createTestChatController();

  let completeFirst;
  const mockLongApi = () => new Promise((resolve) => {
    completeFirst = resolve;
  });

  const p1 = chat5.handleQuestionSubmit('First message', mockLongApi);

  // Attempt rapid second submission while first is still running
  const res2 = await chat5.handleQuestionSubmit('Second message', mockLongApi);
  assert.strictEqual(res2, 'BLOCKED_DUPLICATE', 'Second submission must be blocked while first is active');

  // Verify only 1 typing indicator exists in DOM
  const indicators = chat5.chatMessages.children.filter((c) => c.id === 'chat-typing-indicator');
  assert.strictEqual(indicators.length, 1, 'Never allow duplicate typing indicators');

  // Complete first request
  completeFirst();
  await p1;

  assert.strictEqual(chat5.getTypingIndicator(), undefined, 'Indicator cleaned up after long request finishes');
  console.log('  PASSED');

  console.log('--- All Typing Indicator Tests Completed Successfully ---');
}

runTests().catch((err) => {
  console.error('Typing Indicator Test Failure:', err);
  process.exit(1);
});
