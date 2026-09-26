// Augmentor — DSH voice plugin over LAN InferenzQuelle
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// Extracts speakable prose from committed assistant messages. Reasoning,
// tool-call and tool-result blocks never reach here — only `type:'text'`
// content is visible prose. Markdown decoration is flattened so the speech
// engine does not read out markup; fenced code blocks are dropped entirely.

export function visibleText(message) {
  const content = message?.content
  const parts = (Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
  return parts.join('\n').trim() || null
}

export function stripForSpeech(text, { maxChars = 6000 } = {}) {
  let value = String(text)
  value = value.replace(/```[\s\S]*?(?:```|$)/g, '\n') // fenced code blocks
  value = value.replace(/`([^`\n]*)`/g, '$1') // inline code keeps its text
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
  value = value.replace(/^ {0,3}#{1,6}\s+/gm, '') // heading marks
  value = value.replace(/^ {0,3}>\s?/gm, '') // block quotes
  value = value.replace(/^ {0,3}(?:[-*+]|\d+[.)])\s+/gm, '') // list markers
  value = value.replace(/^ {0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/gm, '') // rules
  value = value.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  value = value.replace(/\*([^*\n]+)\*/g, '$1').replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
  value = value.replace(/~~([^~]+)~~/g, '$1')
  value = value.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n')
  value = value.replace(/\n{3,}/g, '\n\n').trim()
  if (value.length > maxChars) {
    const cut = value.slice(0, maxChars)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'))
    value = (end > maxChars * 0.5 ? cut.slice(0, end + 1) : cut).trim()
  }
  return value
}
