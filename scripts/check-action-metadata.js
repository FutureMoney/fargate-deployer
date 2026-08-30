#!/usr/bin/env node
/**
 * Check action.yml against the GitHub Marketplace's publishing rules.
 *
 * The Marketplace only validates these when you tick "publish" on a release —
 * by which point the tag is cut, the release is written and you are reading an
 * error like "Description must be less than 125 characters." Nothing else in
 * the toolchain checks them: actionlint validates workflow syntax, not listing
 * metadata.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('yaml');

/** Icons the Marketplace accepts come from Feather; colour is a fixed set. */
const COLORS = ['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark'];

/** The Marketplace rejects a description at or above this length. */
const DESCRIPTION_LIMIT = 125;

function main() {
  const file = path.join(__dirname, '..', 'action.yml');
  const action = parse(fs.readFileSync(file, 'utf-8'));
  const problems = [];

  const require_ = (field, value) => {
    if (!value || String(value).trim() === '') {
      problems.push(`${field} is required to list on the Marketplace`);
      return false;
    }
    return true;
  };

  require_('name', action.name);
  require_('author', action.author);

  if (require_('description', action.description)) {
    const length = action.description.trim().length;
    if (length >= DESCRIPTION_LIMIT) {
      problems.push(
        `description is ${length} characters; the Marketplace requires fewer than ${DESCRIPTION_LIMIT}. ` +
          'Shorten it and let the README carry the detail.',
      );
    }
  }

  const branding = action.branding ?? {};
  require_('branding.icon', branding.icon);
  if (require_('branding.color', branding.color) && !COLORS.includes(branding.color)) {
    problems.push(`branding.color must be one of ${COLORS.join(', ')}, got ${branding.color}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      // Annotate the file in the GitHub Actions UI when running there.
      console.error(`::error file=action.yml::${problem}`);
      console.error(`✗ ${problem}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ action.yml is publishable (description ${action.description.trim().length}/${DESCRIPTION_LIMIT - 1} chars).`,
  );
}

main();
