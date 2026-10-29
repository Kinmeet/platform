// Fails if the PR description's "Requested by" line names a person (firm
// rule 3, #168). CI passes the description in PR_BODY; it is never echoed,
// so a name it holds doesn't reach the log.
import { requestedByProblems } from './pr-body'

const problems = requestedByProblems(process.env.PR_BODY ?? '')

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error('Edit the description to say "Requested by the founder"; this check runs again.')
  process.exit(1)
}
console.log('PR description check passed: no one is named in a "Requested by" line.')
