import { setupGit } from './setup-git.mjs'
import { buildWeb } from './build-web.mjs'
import { initializeWorkspace } from './initialize.mjs'

setupGit()
initializeWorkspace()
await buildWeb()
