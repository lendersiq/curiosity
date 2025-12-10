// js/statistical.js
// Statistical analysis library for query results

/**
 * Calculate mean (average) of numeric values
 */
function mean(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;
  if (nums.length === 1) return 0;
  
  const avg = mean(nums);
  const squaredDiffs = nums.map(v => Math.pow(v - avg, 2));
  const avgSquaredDiff = mean(squaredDiffs);
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate median
 */
function median(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/**
 * Calculate minimum value
 */
function min(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

/**
 * Calculate maximum value
 */
function max(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/**
 * Calculate mode (most frequent value)
 */
function mode(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;

  const frequency = {};
  nums.forEach(n => {
    const key = n; // Use number as key
    frequency[key] = (frequency[key] || 0) + 1;
  });

  let mode = null;
  let maxCount = 0;
  for (const [value, count] of Object.entries(frequency)) {
    if (count > maxCount) {
      mode = Number(value);
      maxCount = count;
    }
  }

  // If all values are equally frequent, return the first one
  return mode;
}

/**
 * Calculate sum
 */
function sum(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  return nums.reduce((s, v) => s + v, 0);
}

/**
 * Calculate count (non-null values)
 */
function count(values) {
  return values.filter(v => v != null && v !== '').length;
}

/**
 * Calculate variance
 */
function variance(values) {
  const nums = values.filter(v => v != null && !isNaN(v)).map(v => Number(v));
  if (nums.length === 0) return null;
  if (nums.length === 1) return 0;
  
  const avg = mean(nums);
  const squaredDiffs = nums.map(v => Math.pow(v - avg, 2));
  return mean(squaredDiffs);
}

/**
 * Extract numeric values from a field in rows
 */
function extractFieldValues(rows, fieldName) {
  return rows.map(row => row[fieldName]);
}

/**
 * Apply statistical operation to query results
 */
function applyStatisticalOperation(rows, fieldName, operation) {
  if (!rows || rows.length === 0) return null;
  
  const values = extractFieldValues(rows, fieldName);
  
  switch (operation.toLowerCase()) {
    case 'mean':
    case 'average':
    case 'avg':
      return mean(values);
    case 'standard deviation':
    case 'std dev':
    case 'stddev':
    case 'std':
      return standardDeviation(values);
    case 'median':
      return median(values);
    case 'min':
    case 'minimum':
      return min(values);
    case 'max':
    case 'maximum':
      return max(values);
    case 'sum':
      return sum(values);
    case 'count':
      return count(values);
    case 'variance':
      return variance(values);
    default:
      return null;
  }
}

/**
 * Format statistical result for display
 */
function formatStatisticalResult(operation, value, fieldName) {
  if (value == null) return null;
  
  const operationNames = {
    'mean': 'Mean',
    'average': 'Average',
    'avg': 'Average',
    'standard deviation': 'Standard Deviation',
    'std dev': 'Standard Deviation',
    'stddev': 'Standard Deviation',
    'std': 'Standard Deviation',
    'median': 'Median',
    'min': 'Minimum',
    'minimum': 'Minimum',
    'max': 'Maximum',
    'maximum': 'Maximum',
    'sum': 'Sum',
    'count': 'Count',
    'variance': 'Variance'
  };
  
  const opName = operationNames[operation.toLowerCase()] || operation;
  
  // Format number with appropriate precision
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { operation: opName, value: value, field: fieldName };
    } else {
      // Round to reasonable precision
      const rounded = Math.round(value * 10000) / 10000;
      return { operation: opName, value: rounded, field: fieldName };
    }
  }
  
  return { operation: opName, value: value, field: fieldName };
}

// expose globally
window.Statistical = {
  mean,
  standardDeviation,
  median,
  min,
  max,
  sum,
  count,
  variance,
  mode,
  extractFieldValues,
  applyStatisticalOperation,
  formatStatisticalResult
};

