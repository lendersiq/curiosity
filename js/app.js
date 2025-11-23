// js/app.js
(function () {
  // Access window objects when needed (don't destructure at top level)
  let sourcesMeta = [];
  let expandedRows = new Set();
  let currentRows = [];

  async function main() {
    await window.DB.initDB();

    const fileInput = document.getElementById("file-input");
    const btnImport = document.getElementById("btn-import");
    const sourcesUl = document.getElementById("sources-ul");
    const schemaPre = document.getElementById("schema-pre");
    const promptInput = document.getElementById("prompt-input");
    const btnRun = document.getElementById("btn-run");
    const planPre = document.getElementById("plan-pre");
    const resultsContainer = document.getElementById("results-container");

    sourcesMeta = await listSources();
    renderSourcesList();

    btnImport.addEventListener("click", async () => {
      try {
        const files = fileInput.files;
        if (!files || !files.length) {
          alert("Select at least one file first.");
          return;
        }
        const imported = await window.DataManager.importFiles(files);
        sourcesMeta = await window.DataManager.listSources();
        renderSourcesList();
        fileInput.value = "";
        alert(`Imported ${imported.length} file(s)`);
      } catch (err) {
        console.error(err);
        alert("Error importing files: " + err.message);
      }
    });

    sourcesUl.addEventListener("click", async e => {
      const li = e.target.closest("li[data-source-id]");
      if (!li) return;
      const sid = li.getAttribute("data-source-id");
      const schema = await window.DataManager.getSchema(sid);
      schemaPre.textContent = JSON.stringify(schema, null, 2);
    });

    btnRun.addEventListener("click", async () => {
      try {
        const prompt = promptInput.value;
        const parsed = window.NLPEngine.parsePrompt(prompt);

        const planCopy = { ...parsed, conditions: [...parsed.conditions] };

        // Check if multi-source query
        const isMultiSource = planCopy.targetEntities.length > 1;
        
        if (isMultiSource) {
          // Multi-source: find unique ID and columns
          const uniqueId = await window.QueryEngine.findUniqueIdentifierField(sourcesMeta);
          const valuationFields = await window.QueryEngine.identifyValuationFields(sourcesMeta);
          
          // Map conditions for each source to find all possible field names
          const allConditionFields = new Set();
          for (const entity of planCopy.targetEntities) {
            const source = window.QueryEngine.pickSourceForEntity(entity, sourcesMeta);
            if (source) {
              const mapped = await window.ConceptMapper.mapConceptsToFields(source.sourceId, planCopy.conditions);
              mapped.forEach(c => {
                if (c.field) allConditionFields.add(c.field);
              });
            }
          }
          
          // Build columns: uniqueId first, then condition fields, then valuation fields
          const columns = [
            uniqueId,
            ...Array.from(allConditionFields).filter(f => !valuationFields.includes(f)),
            ...valuationFields
          ].filter((v, i, a) => a.indexOf(v) === i); // unique

          planCopy.uniqueId = uniqueId;
          planCopy.columns = columns;
        } else if (planCopy.targetEntities.length && sourcesMeta.length) {
          // Single source: map conditions
          const mainEntity = planCopy.targetEntities[0];
          const source = window.QueryEngine.pickSourceForEntity(mainEntity, sourcesMeta);
          if (source) {
            planCopy.conditions = await window.ConceptMapper.mapConceptsToFields(
              source.sourceId,
              planCopy.conditions
            );
          }
        }

        planPre.textContent = JSON.stringify(planCopy, null, 2);

        const result = await window.QueryEngine.executeQueryPlan(planCopy, sourcesMeta);
        currentRows = result.rows;
        
        // Keep expanded state for rows that still exist
        const newExpanded = new Set();
        expandedRows.forEach(idx => {
          if (idx < currentRows.length && currentRows[idx]._isAggregated) {
            newExpanded.add(idx);
          }
        });
        expandedRows = newExpanded;
        
        // Add valuationFields to queryPlan for rendering
        if (result.valuationFields) {
          planCopy.valuationFields = result.valuationFields;
        }
        
        const usedSources = result.usedSources || (result.usedSource ? [result.usedSource] : []);
        renderResults(result.rows, usedSources, resultsContainer, planCopy);
      } catch (err) {
        console.error(err);
        alert("Error executing query: " + err.message);
      }
    });

    function renderSourcesList() {
      sourcesUl.innerHTML = "";
      sourcesMeta.forEach(src => {
        const li = document.createElement("li");
        li.setAttribute("data-source-id", src.sourceId);
        li.className = "source-item";
        
        // Detect entity types
        const entities = window.DataManager.detectEntityTypes(src);
        
        // Create entity tags
        const entityTags = entities.map(entity => {
          const tag = document.createElement("span");
          tag.className = `entity-tag entity-tag-${entity}`;
          tag.textContent = entity;
          return tag.outerHTML;
        }).join("");
        
        li.innerHTML = `
          <div class="source-item-header">
            <div class="source-item-info">
              <span class="source-name">${src.name}</span>
              <div class="source-entities">${entityTags}</div>
              <small class="source-filename">${src.originalFileName || src.name}</small>
            </div>
            <div class="source-item-actions">
              <button class="btn-icon btn-update" title="Refresh source" data-action="update" data-source-id="${src.sourceId}">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11.5 2.5C10.5 1.5 9.1 1 7.5 1C4.2 1 1.5 3.7 1.5 7C1.5 10.3 4.2 13 7.5 13C10.3 13 12.7 10.9 13.2 8.2"/>
                  <path d="M11.5 2.5L13.5 1L11.5 4.5"/>
                </svg>
              </button>
              <button class="btn-icon btn-delete" title="Remove source" data-action="delete" data-source-id="${src.sourceId}">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M3 3L11 11M11 3L3 11"/>
                </svg>
              </button>
            </div>
          </div>
        `;
        sourcesUl.appendChild(li);
      });

      if (!sourcesMeta.length) {
        sourcesUl.innerHTML = `<li><small>No sources loaded yet.</small></li>`;
      }
      
      // Add event listeners for update/delete buttons
      sourcesUl.querySelectorAll('.btn-icon').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.getAttribute('data-action');
          const sourceId = btn.getAttribute('data-source-id');
          
          if (action === 'delete') {
            if (confirm('Are you sure you want to remove this source?')) {
              // Remove from DOM immediately
              const sourceItem = btn.closest('li[data-source-id]');
              if (sourceItem) {
                sourceItem.style.opacity = '0.5';
                sourceItem.style.transition = 'opacity 0.2s';
                setTimeout(() => {
                  sourceItem.remove();
                }, 200);
              }
              
              // Update sourcesMeta immediately
              sourcesMeta = sourcesMeta.filter(s => s.sourceId !== sourceId);
              
              // Clear schema display if deleted source was selected
              const schemaPre = document.getElementById("schema-pre");
              if (schemaPre) schemaPre.textContent = "";
              
              // Perform async deletion in background
              window.DataManager.deleteSource(sourceId).catch(err => {
                console.error('Error removing source from database:', err);
                // Re-render list if deletion failed
                window.DataManager.listSources().then(updated => {
                  sourcesMeta = updated;
                  renderSourcesList();
                });
              });
            }
          } else if (action === 'update') {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.json';
            input.onchange = async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              
              const updateBtn = btn;
              try {
                updateBtn.disabled = true;
                updateBtn.style.opacity = '0.5';
                updateBtn.style.cursor = 'wait';
                await window.DataManager.updateSource(sourceId, file);
                sourcesMeta = await window.DataManager.listSources();
                renderSourcesList();
              } catch (err) {
                console.error(err);
                alert('Error updating source: ' + err.message);
              } finally {
                updateBtn.disabled = false;
                updateBtn.style.opacity = '1';
                updateBtn.style.cursor = 'pointer';
              }
            };
            input.click();
          }
        });
      });
    }
  }

  function detectDecimalPrecision(value) {
    if (typeof value !== 'number') return 2;
    const str = value.toString();
    if (str.includes('.')) {
      return str.split('.')[1].length;
    }
    return 2;
  }

  function formatNumber(value, isValuationField = false) {
    if (value == null || value === '') return '';
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
    if (Number.isNaN(num)) return value;
    
    if (isValuationField) {
      return num.toFixed(2);
    }
    
    const precision = detectDecimalPrecision(value);
    return num.toFixed(Math.min(precision, 10));
  }

  function renderResults(rows, usedSources, resultsContainer, queryPlan) {
    if (!rows || !rows.length) {
      resultsContainer.innerHTML = `<div class="results-empty">No rows matched the query.</div>`;
      return;
    }

    // Determine columns
    let columns = [];
    if (queryPlan && queryPlan.columns && queryPlan.columns.length) {
      columns = queryPlan.columns;
    } else {
      const keys = Object.keys(rows[0]);
      columns = keys.filter(k => !k.startsWith('_'));
    }

    // Create table wrapper for sticky header
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    
    columns.forEach(k => {
      const th = document.createElement("th");
      th.textContent = k;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    
    // Check if we have aggregated rows
    const hasAggregated = rows.some(r => r._isAggregated);
    // Get valuation fields from query plan or detect from columns
    const valuationFields = queryPlan?.valuationFields || 
      columns.filter(c => /principal|balance|amount|value/i.test(c));
    const uniqueId = queryPlan?.uniqueId || columns[0];

    rows.forEach((row, rowIndex) => {
      const isAggregated = row._isAggregated;
      const isExpanded = expandedRows.has(rowIndex);
      const hasSubRows = isAggregated && row._subRows && row._subRows.length > 0;

      // Main row
      const tr = document.createElement("tr");
      if (isAggregated) {
        tr.className = "row-aggregated";
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
          if (isExpanded) {
            expandedRows.delete(rowIndex);
          } else {
            expandedRows.add(rowIndex);
          }
          renderResults(rows, usedSources, resultsContainer, queryPlan);
        });
      }

      columns.forEach((col, colIndex) => {
        const td = document.createElement("td");
        
        if (colIndex === 0 && isAggregated) {
          // First column: show expand/collapse indicator
          td.innerHTML = `<span class="expand-indicator">${isExpanded ? '▼' : '▶'}</span> ${row[col] || ''}`;
        } else {
          const isValuation = valuationFields.includes(col);
          const value = row[col];
          td.textContent = isValuation ? formatNumber(value, true) : (value != null ? value : '');
        }
        
        tr.appendChild(td);
      });
      
      tbody.appendChild(tr);

      // Sub-rows (expanded aggregated row)
      if (isExpanded && hasSubRows) {
        row._subRows.forEach((subRow, subIndex) => {
          const subTr = document.createElement("tr");
          subTr.className = "row-subgroup";

          columns.forEach((col, colIndex) => {
            const td = document.createElement("td");
            
            if (colIndex === 0) {
              // First column: spacer with tree indicator
              td.innerHTML = `<span class="tree-indicator">└</span>`;
              td.className = "subgroup-spacer";
            } else {
              const isValuation = valuationFields.includes(col);
              const value = subRow[col];
              td.textContent = isValuation ? formatNumber(value, true) : (value != null ? value : '');
            }
            
            subTr.appendChild(td);
          });
          
          tbody.appendChild(subTr);
        });
      }
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);

    // Source tags
    const metaDiv = document.createElement("div");
    metaDiv.className = "results-meta";
    
    if (usedSources.length > 0) {
      const sourceTags = usedSources.map(s => {
        const tag = document.createElement("span");
        tag.className = "source-tag";
        tag.textContent = s.name || s.originalFileName;
        return tag;
      });
      
      const sourcesLabel = document.createElement("span");
      sourcesLabel.textContent = "Sources: ";
      sourcesLabel.style.marginRight = "8px";
      metaDiv.appendChild(sourcesLabel);
      
      sourceTags.forEach(tag => metaDiv.appendChild(tag));
      
      const countSpan = document.createElement("span");
      countSpan.style.marginLeft = "12px";
      countSpan.style.opacity = "0.7";
      const totalRows = rows.reduce((sum, r) => sum + (r._subRows ? r._subRows.length : 1), 0);
      countSpan.textContent = `(${rows.length} ${hasAggregated ? 'combined' : ''} result${rows.length !== 1 ? 's' : ''}${hasAggregated ? `, ${totalRows} total rows` : ''})`;
      metaDiv.appendChild(countSpan);
    }

    // Export button
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn-export";
    exportBtn.textContent = "Export to CSV";
    exportBtn.addEventListener("click", () => exportToCSV(rows, columns, queryPlan));
    metaDiv.appendChild(exportBtn);

    resultsContainer.innerHTML = "";
    resultsContainer.appendChild(metaDiv);
    resultsContainer.appendChild(tableWrapper);
  }

  function exportToCSV(rows, columns, queryPlan) {
    try {
      // Flatten rows (include all sub-rows for aggregated rows)
      const flatRows = [];
      rows.forEach((row, idx) => {
        if (row._isAggregated && row._subRows && row._subRows.length > 0) {
          // Include all sub-rows for aggregated rows
          row._subRows.forEach(subRow => {
            const flat = {};
            columns.forEach(col => {
              const val = subRow[col];
              flat[col] = val != null && val !== '' ? val : '';
            });
            flatRows.push(flat);
          });
        } else {
          // Include main row
          const flat = {};
          columns.forEach(col => {
            const val = row[col];
            flat[col] = val != null && val !== '' ? val : '';
          });
          flatRows.push(flat);
        }
      });

      // Create CSV content
      const csvLines = [];
      
      // Header row
      csvLines.push(columns.map(col => escapeCSVValue(col)).join(','));
      
      // Data rows
      flatRows.forEach(row => {
        const values = columns.map(col => {
          const val = row[col];
          return escapeCSVValue(val);
        });
        csvLines.push(values.join(','));
      });
      
      const csvContent = csvLines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `curiosity-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert("Error exporting to CSV: " + err.message);
    }
  }

  function escapeCSVValue(value) {
    if (value == null || value === '') return '';
    const str = String(value);
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // kick off once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
