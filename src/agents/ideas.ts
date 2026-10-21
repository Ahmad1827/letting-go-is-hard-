import type { Idea, ProjectInfo } from './types';

/**
 * Comes up with pitches from what's actually in a project folder.
 * Stand-in for the real agents, which will read the code and write their own.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

export function branchFor(agent: string, title: string) {
  return `agent/${agent.toLowerCase()}-${slug(title)}`;
}

type Make = (p: ProjectInfo) => Omit<Idea, 'project' | 'path' | 'branch'> | null;

const IDEAS: Make[] = [
  (p) => p.hasTests ? null : {
    title: `Add automated tests to ${p.name}`,
    summary: `${p.name} has ${p.files} files and no tests I could find. A small test suite around the core logic would catch regressions before they ship.`,
    steps: ['Pick a test runner that fits the stack', `Cover the riskiest code first${p.biggest ? ` (${p.biggest})` : ''}`, 'Add a one-line command to run them'],
  },
  (p) => p.hasReadme ? null : {
    title: `Write a README for ${p.name}`,
    summary: `There's no README, so anyone opening ${p.name} (including future you) has to read the code to learn what it does and how to run it.`,
    steps: ['Describe what the project does', 'Document setup and run commands', 'Add a screenshot or example output'],
  },
  (p) => p.hasCi || !p.isGit ? null : {
    title: `Set up CI for ${p.name}`,
    summary: `Every push to ${p.name} goes unchecked. A GitHub Actions workflow could build${p.hasTests ? ' and test' : ''} it automatically.`,
    steps: ['Add a workflow that installs dependencies', p.hasTests ? 'Run the test suite on every push' : 'Run the build and a linter on every push', 'Add a status badge to the README'],
  },
  (p) => !p.biggest ? null : {
    title: `Split up ${p.biggest.split('/').pop()}`,
    summary: `${p.biggest} is the largest source file in ${p.name}. Breaking it into smaller modules would make it easier to change without side effects.`,
    steps: ['Map what the file is responsible for', 'Move each responsibility into its own module', 'Check behaviour is unchanged'],
  },
  (p) => !p.languages.includes('TypeScript') ? null : {
    title: `Tighten up TypeScript in ${p.name}`,
    summary: 'Turning on stricter compiler checks usually finds real bugs: unchecked nulls, implicit anys, unused code.',
    steps: ['Enable strict mode and noUnusedLocals', 'Fix the errors it reports', 'Remove dead code it uncovers'],
  },
  (p) => !p.languages.includes('Python') ? null : {
    title: `Add type hints to ${p.name}`,
    summary: 'Type hints plus a mypy check would catch whole classes of mistakes in the Python code before running it.',
    steps: ['Annotate the public functions', 'Add mypy to the dev tools', 'Fix what it finds'],
  },
  (p) => !(p.languages.includes('HTML') || p.languages.includes('CSS')) ? null : {
    title: `Accessibility pass on ${p.name}`,
    summary: 'A quick audit for keyboard navigation, contrast and labels would make the UI usable by more people.',
    steps: ['Check every control works with the keyboard', 'Fix low-contrast colours', 'Label images and form fields'],
  },
  (p) => p.files < 5 ? null : {
    title: `Better error handling in ${p.name}`,
    summary: `I'd like to look for places where ${p.name} fails silently and make errors visible and recoverable.`,
    steps: ['Find swallowed errors and unchecked results', 'Add clear messages and logging', 'Handle the common failure cases gracefully'],
  },
  (p) => !p.lastCommit ? null : {
    title: `Follow up on "${p.lastCommit.slice(0, 48)}${p.lastCommit.length > 48 ? '...' : ''}"`,
    summary: `The last change in ${p.name} was "${p.lastCommit}". I'd review it for loose ends and polish what it started.`,
    steps: ['Read the last commit carefully', 'List what is unfinished or fragile', 'Tidy it up'],
  },
];

/** A fresh idea for `project`, avoiding titles already pitched. */
export function ideaFor(agent: string, project: ProjectInfo, seen: Set<string>): Idea {
  const options = IDEAS.map((make) => make(project)).filter((i) => i && !seen.has(i.title));
  const pick = options[Math.floor(Math.random() * options.length)] ?? {
    title: `General clean-up of ${project.name}`,
    summary: `Nothing urgent jumped out in ${project.name}, so I'd do a careful clean-up: naming, dead code, small bugs.`,
    steps: ['Read through the main code paths', 'Fix small issues as I find them', 'Summarise anything bigger for you'],
  };
  return { ...pick!, project: project.name, path: project.path, branch: branchFor(agent, pick!.title) };
}

/** The idea when the owner tells an agent exactly what to do. */
export function ordered(agent: string, project: string, path: string | null, instruction: string, isNew: boolean): Idea {
  const title = instruction.length > 60 ? `${instruction.slice(0, 57)}...` : instruction;
  return {
    project,
    path,
    title,
    summary: isNew ? `Start a new project, ${project}: ${instruction}` : instruction,
    steps: isNew ? ['Create the project folder and git repo', 'Build a first working version', 'Write a README'] : ['Read the relevant code', 'Make the change', 'Check it works'],
    branch: branchFor(agent, title),
  };
}
