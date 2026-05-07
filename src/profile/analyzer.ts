export interface OptimizationRecommendation {
  summary: {
    total_runtime_ms: string;
    compile_time_ms: string;
    execution_time_ms: string;
    bottlenecks: string[];
  };
  suggestions: Array<{
    issue: string;
    recommendation: string;
    impact: 'high' | 'medium' | 'low';
  }>;
  optimizedQuery?: string;
}

interface ProfileShape {
  query_info?: {
    text_profile?: string;
    total_runtime_ms?: string;
    compile_time_stats?: { total?: string };
  };
}

export function analyzeProfileData(profileData: unknown): OptimizationRecommendation {
  const result: OptimizationRecommendation = {
    summary: {
      total_runtime_ms: '0',
      compile_time_ms: '0',
      execution_time_ms: '0',
      bottlenecks: [],
    },
    suggestions: [],
  };

  let profile: ProfileShape;
  try {
    profile = typeof profileData === 'string' ? (JSON.parse(profileData) as ProfileShape) : (profileData as ProfileShape);
  } catch {
    result.suggestions.push({
      issue: 'Profile data could not be parsed',
      recommendation: 'PROFILE returned non-JSON output; check the original SELECT query.',
      impact: 'high',
    });
    return result;
  }

  const queryInfo = profile?.query_info ?? {};
  result.summary.total_runtime_ms = queryInfo.total_runtime_ms ?? '0';

  const compile = queryInfo.compile_time_stats?.total;
  if (compile) {
    result.summary.compile_time_ms = compile;
    const totalTime = Number.parseInt(result.summary.total_runtime_ms, 10);
    const compileTime = Number.parseInt(compile, 10);
    if (Number.isFinite(totalTime) && Number.isFinite(compileTime)) {
      result.summary.execution_time_ms = String(totalTime - compileTime);
    }
  }

  analyzeExecutionPlan(profile, result);
  analyzeMemoryAndStats(profile, result);
  analyzeNetworkTraffic(profile, result);
  analyzeCompilationTime(profile, result);
  analyzePartitionSkew(profile, result);
  identifyBottlenecks(profile, result);

  return result;
}

function analyzeExecutionPlan(profile: ProfileShape, result: OptimizationRecommendation): void {
  const text = profile.query_info?.text_profile ?? '';
  if (text.includes('TableScan') && !text.includes('IndexScan')) {
    result.suggestions.push({
      issue: 'Full table scan detected',
      recommendation: 'Add an index on the columns referenced in WHERE clauses to avoid scanning the entire table.',
      impact: 'high',
    });
  }
  if (text.includes('HashJoin')) {
    const rowsMatch = text.match(/actual_rows: (\d+)/);
    if (rowsMatch && rowsMatch[1] && Number.parseInt(rowsMatch[1], 10) > 10_000) {
      result.suggestions.push({
        issue: 'Large hash join operation',
        recommendation: 'Consider indexes on join columns or a better shard key to reduce hash table size.',
        impact: 'medium',
      });
    }
  }
}

function analyzeMemoryAndStats(profile: ProfileShape, result: OptimizationRecommendation): void {
  const text = profile.query_info?.text_profile ?? '';
  for (const line of text.split('\n')) {
    const memMatch = line.match(/memory_usage: (\d+)/);
    if (!memMatch || !memMatch[1]) continue;
    const memoryUsage = Number.parseInt(memMatch[1], 10);
    if (memoryUsage > 100_000) {
      result.suggestions.push({
        issue: `High memory usage (${Math.round(memoryUsage / 1024)} MB)`,
        recommendation: 'Add appropriate indexes, split the query into smaller parts, or revisit large in-memory ops.',
        impact: 'high',
      });
    }
  }
}

function analyzeNetworkTraffic(profile: ProfileShape, result: OptimizationRecommendation): void {
  const text = profile.query_info?.text_profile ?? '';
  let total = 0;
  for (const line of text.split('\n')) {
    const m = line.match(/network_traffic: (\d+(\.\d+)?)/);
    if (m && m[1]) total += Number.parseFloat(m[1]);
  }
  if (total > 100_000) {
    result.suggestions.push({
      issue: `High network traffic (${Math.round(total / 1024)} MB)`,
      recommendation: 'Reduce data movement between nodes via better shard keys and tighter projections.',
      impact: 'high',
    });
  }
}

function analyzeCompilationTime(profile: ProfileShape, result: OptimizationRecommendation): void {
  const compile = Number.parseInt(profile.query_info?.compile_time_stats?.total ?? '0', 10);
  const total = Number.parseInt(profile.query_info?.total_runtime_ms ?? '0', 10);
  if (total > 0 && compile > 0 && compile / total > 0.2) {
    result.suggestions.push({
      issue: `High compilation time (${compile} ms, ${Math.round((compile / total) * 100)}% of total)`,
      recommendation: 'Parameterize the query for plan reuse, or tune compilation-related session variables.',
      impact: 'medium',
    });
  }
}

function analyzePartitionSkew(profile: ProfileShape, result: OptimizationRecommendation): void {
  const text = profile.query_info?.text_profile ?? '';
  for (const line of text.split('\n')) {
    const m = line.match(/max:(\d+) at partition_(\d+), average: (\d+)/);
    if (!m) continue;
    const max = Number.parseInt(m[1] ?? '0', 10);
    const partition = m[2] ?? '?';
    const avg = Number.parseInt(m[3] ?? '0', 10);
    if (avg > 0 && max > avg * 3) {
      result.suggestions.push({
        issue: `Significant data skew detected in partition ${partition}`,
        recommendation: 'Reconsider the shard key choice for more uniform load across partitions.',
        impact: 'high',
      });
    }
  }
}

function identifyBottlenecks(profile: ProfileShape, result: OptimizationRecommendation): void {
  const text = profile.query_info?.text_profile ?? '';
  const execTimes: Array<{ operation: string; time: number }> = [];
  for (const line of text.split('\n')) {
    const m = line.match(/exec_time: (\d+)ms/);
    if (!m || !m[1]) continue;
    const time = Number.parseInt(m[1], 10);
    const opMatch = line.match(/^(\w+)/);
    const operation = opMatch?.[1] ?? 'Unknown';
    execTimes.push({ operation, time });
  }
  execTimes.sort((a, b) => b.time - a.time);
  result.summary.bottlenecks = execTimes
    .slice(0, 3)
    .filter((item) => item.time > 0)
    .map((item) => `${item.operation} (${item.time} ms)`);
}
