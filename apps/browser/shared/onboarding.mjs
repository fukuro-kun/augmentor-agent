// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {access} from 'node:fs/promises'
import {pythonExecutable,componentEnvironment} from '../../../dist/platform/src/index.js'
const run=promisify(execFile)
export async function startOnboarding({topic,requestId}={}){
  if(topic!=='memory'||typeof requestId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))throw Error('Ungültige Setup-Aufgabe.')
  const script=fileURLToPath(new URL('../../native/augmentor_linux/onboarding.py',import.meta.url))
  try{await access(script)}catch(error){
    if(error.code!=='ENOENT')throw error
    throw Error('Das geführte Setup erfordert den Augmentor Agent. Du kannst einen vorhandenen Speicherdienst unter „Erweitert · manuelle Einrichtung und gespeicherte Erinnerungen“ verbinden.')
  }
  const {stdout}=await run(pythonExecutable(),[script,requestId],{timeout:35000,maxBuffer:32768,env:componentEnvironment()})
  const response=JSON.parse(stdout)
  if(!response.ok)throw Error(response.error)
  return response.result
}
