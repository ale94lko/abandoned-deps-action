const fs = require('fs');
const https = require('https');
const path = require('path');

// Action Inputs
const manifestPath = process.env['INPUT_MANIFEST-PATH'] || 'package.json';
const maxMonthsInactive = parseInt(process.env['INPUT_MAX-MONTHS-INACTIVE'] || '12', 10);
const githubToken = process.env['INPUT_GITHUB-TOKEN'] || '';

const COMPOSER_PLATFORM_PACKAGES = new Set(['php', 'hhvm', 'composer', 'composer-plugin-api', 'composer-runtime-api']);

// Helper function for HTTPS requests
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const isGithub = url.startsWith('https://api.github.com/');
    const options = {
      headers: {
        'User-Agent': 'Abandoned-Deps-Action',
        Accept: 'application/json',
        ...(isGithub && githubToken && { 'Authorization': `Bearer ${githubToken}` })
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      if (res.statusCode === 404) return resolve(null);
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', reject);
  });
}

// Extract owner and repo from Git/Registry URLs
function extractGithubRepo(repoUrl) {
  if (!repoUrl) return null;
  const match = String(repoUrl).match(/github\.com[\/:]([^\/]+)\/([^\/\.#]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

function getManifestKind(filePath) {
  return path.basename(filePath).toLowerCase() === 'composer.json' ? 'composer' : 'npm';
}

function isComposerPlatformPackage(name) {
  return COMPOSER_PLATFORM_PACKAGES.has(name)
    || name.startsWith('ext-')
    || name.startsWith('lib-')
    || name.startsWith('composer-');
}

function collectDependencyNames(pkg, kind) {
  if (kind === 'composer') {
    const all = {
      ...(pkg.require || {}),
      ...(pkg['require-dev'] || {})
    };
    return Object.keys(all).filter(name => !isComposerPlatformPackage(name));
  }

  return Object.keys({
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {})
  });
}

function getComposerSourceUrl(packagistPackage) {
  if (packagistPackage.repository) return packagistPackage.repository;

  const versions = packagistPackage.versions;
  if (!versions) return null;

  for (const version of Object.values(versions)) {
    if (version.source && version.source.url) return version.source.url;
  }

  return null;
}

async function resolvePackageSource(dep, kind) {
  if (kind === 'composer') {
    const packagistData = await fetchJSON(`https://packagist.org/packages/${dep}.json`);
    if (!packagistData || !packagistData.package) return null;

    return {
      repoUrl: getComposerSourceUrl(packagistData.package),
      isAbandoned: Boolean(packagistData.package.abandoned)
    };
  }

  const npmData = await fetchJSON(`https://registry.npmjs.org/${dep}`);
  if (!npmData || !npmData.repository) return null;

  return {
    repoUrl: npmData.repository.url || npmData.repository,
    isAbandoned: false
  };
}

function getStatusLabel(item) {
  if (item.isAbandoned) return '🚫 Abandoned';
  if (item.isArchived) return '🔒 Archived';
  return '💤 Inactive';
}

async function run() {
  const kind = getManifestKind(manifestPath);
  console.log(`🔍 Reading ${kind === 'composer' ? 'Composer' : 'npm'} manifest at: ${manifestPath}...`);

  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(manifestPath, 'utf-8');
  const pkg = JSON.parse(rawData);
  const depNames = collectDependencyNames(pkg, kind);

  console.log(`📦 Found ${depNames.length} dependencies to audit.\n`);

  const now = new Date();
  const abandonedDeps = [];

  for (const dep of depNames) {
    const source = await resolvePackageSource(dep, kind);
    if (!source) continue;

    const repoInfo = extractGithubRepo(source.repoUrl);
    const githubData = repoInfo
      ? await fetchJSON(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`)
      : null;

    const lastPushedAt = githubData && githubData.pushed_at ? new Date(githubData.pushed_at) : null;
    const monthsDifference = lastPushedAt
      ? (now.getFullYear() - lastPushedAt.getFullYear()) * 12 + (now.getMonth() - lastPushedAt.getMonth())
      : null;

    const isArchived = Boolean(githubData && githubData.archived);
    const isInactive = monthsDifference !== null && monthsDifference >= maxMonthsInactive;

    if (isInactive || isArchived || source.isAbandoned) {
      abandonedDeps.push({
        name: dep,
        repo: repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : 'N/A',
        lastUpdate: lastPushedAt ? lastPushedAt.toISOString().split('T')[0] : 'N/A',
        monthsInactive: monthsDifference !== null ? monthsDifference : 'N/A',
        isArchived,
        isAbandoned: source.isAbandoned
      });
    }
  }

  // Final Summary Output
  console.log('--------------------------------------------------');
  if (abandonedDeps.length === 0) {
    console.log('✅ All dependencies are actively maintained!');
  } else {
    console.log(`⚠️ Found ${abandonedDeps.length} inactive or zombie dependencies:\n`);

    // Build GitHub Step Summary Markdown Table
    let summaryMarkdown = `### ⚠️ Zombie Dependencies Warning\n\n| Package | Repository | Last Push | Inactivity | Status |\n|---|---|---|---|---|\n`;

    abandonedDeps.forEach(item => {
      const status = getStatusLabel(item);
      const inactivity = item.monthsInactive === 'N/A' ? 'N/A' : `${item.monthsInactive} months`;
      const repoCell = item.repo === 'N/A' ? 'N/A' : `[${item.repo}](https://github.com/${item.repo})`;
      console.log(`- ${item.name} (${item.repo}): Inactive for ${inactivity} [Last push: ${item.lastUpdate}] ${status}`);
      summaryMarkdown += `| **${item.name}** | ${repoCell} | ${item.lastUpdate} | ${inactivity} | ${status} |\n`;
    });

    // Write to GITHUB_STEP_SUMMARY environment file if present
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown);
    }
  }
}

run().catch(err => {
  console.error('❌ Error executing the Action:', err);
  process.exit(1);
});
