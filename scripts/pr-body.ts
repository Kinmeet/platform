// Firm rule 3 for PR descriptions: people appear publicly by role title
// only, and the founder as "the founder" (#168). The PR tooling writes a
// line that opens "Requested by …" near the top of each description, so a
// line that starts that way must name a role, never a person.
//
// A role title starts with "the" ("the founder", "the Head of Delivery"); a
// name doesn't. Prose further into a line ("as requested by …") is left to
// the reviewer.

// After "by": spaces, emphasis, a colon or a dash (Ezra, #169).
const REQUESTED_BY = /^[\s>*_-]*requested by[\s*_:\-–—]+(.*)$/i

// The requester runs up to the tooling's " · " separator, a link or the end.
function requester(rest: string): string {
  return rest
    .split(/\s+·\s+|\s*\[/)[0]!
    .replace(/[*_`]/g, '')
    .trim()
}

export function requestedByProblems(body: string): string[] {
  const problems: string[] = []
  body.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(REQUESTED_BY)
    if (!match) return
    const who = requester(match[1]!)
    if (!/^the\s+\S/i.test(who)) {
      problems.push(
        `line ${index + 1}: "Requested by" must name a role, such as "the founder", never a person`,
      )
    }
  })
  return problems
}
