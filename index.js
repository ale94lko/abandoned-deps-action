const fs = require('fs');
const https = require('https');

// Action Inputs
const manifestPath = process.env['INPUT_MANIFEST-PATH'] || 'package.json';
const maxMonthsInactive = parseInt(process.env['INPUT_MAX-MONTHS-INACTIVE'] || '12', 10);
const githubToken = process.env['INPUT_GITHUB-TOKEN'] || '';

// Helper function for HTTPS requests
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Abandoned-Deps-Action',
        ...(githubToken && { 'Authorization': `Bearer ${githubToken}` })
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
  const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.#]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

async function run() {
  console.log(`🔍 Reading manifest file at: ${manifestPath}...`);

  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(manifestPath, 'utf-8');
  const pkg = JSON.parse(rawData);

  const dependencies = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };

  const depNames = Object.keys(dependencies);
  console.log(`📦 Found ${depNames.length} dependencies to audit.\n`);

  const now = new Date();
  const abandonedDeps = [];

  for (const dep of depNames) {
    // 1. Fetch package metadata from NPM Registry
    const npmData = await fetchJSON(`https://registry.npmjs.org/${dep}`);
    if (!npmData || !npmData.repository) continue;

    const repoInfo = extractGithubRepo(npmData.repository.url || npmData.repository);
    if (!repoInfo) continue;

    // 2. Fetch repository activity metadata from GitHub API
    const githubData = await fetchJSON(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`);
    if (!githubData) continue;

    const lastPushedAt = new Date(githubData.pushed_at);
    const monthsDifference = (now.getFullYear() - lastPushedAt.getFullYear()) * 12 + (now.getMonth() - lastPushedAt.getMonth());

    if (monthsDifference >= maxMonthsInactive || githubData.archived) {
      abandonedDeps.push({
        name: dep,
        repo: `${repoInfo.owner}/${repoInfo.repo}`,
        lastUpdate: lastPushedAt.toISOString().split('T')[0],
        monthsInactive: monthsDifference,
        isArchived: githubData.archived || false
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
      const status = item.isArchived ? '🔒 Archived' : '💤 Inactive';
      console.log(`- ${item.name} (${item.repo}): Inactive for ${item.monthsInactive} months [Last push: ${item.lastUpdate}] ${status}`);
      summaryMarkdown += `| **${item.name}** | [${item.repo}](https://github.com/${item.repo}) | ${item.lastUpdate} | ${item.monthsInactive} months | ${status} |\n`;
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