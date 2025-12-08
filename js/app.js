// js/app.js
(function () {
  // Access window objects when needed (don't destructure at top level)
  let sourcesMeta = [];
  let expandedRows = new Set();
  let currentRows = [];
  let selectedFilesDiv, selectedFilesList, fileStatusEl;

  // Prompt log for tracking user queries and their performance
  let promptLog = [];

  const SUPPORTED_FILE_TYPES = new Set(["csv", "json", "xlsx"]);

  // Prompt log management functions
  function categorizePrompt(validation, executionSuccess, confidence) {
    if (!validation.isValid || !executionSuccess) return 'error';
    if (confidence >= 0.8) return 'success';
    if (confidence >= 0.5) return 'warning';
    return 'error';
  }

  function logPrompt(prompt, parsedPlan, validation, executionResult) {
    const confidence = validation.confidence || 0;
    const category = categorizePrompt(validation, executionResult.success, confidence);

    const logEntry = {
      id: `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      prompt: prompt,
      parsedPlan: parsedPlan,
      validation: validation,
      execution: executionResult,
      category: category
    };

    promptLog.unshift(logEntry); // Add to beginning for most recent first

    // Keep only last 50 prompts to prevent memory issues
    if (promptLog.length > 50) {
      promptLog = promptLog.slice(0, 50);
    }

    console.log('Prompt logged:', logEntry);
  }

  function getPromptStats() {
    const total = promptLog.length;
    const successCount = promptLog.filter(p => p.category === 'success').length;
    const warningCount = promptLog.filter(p => p.category === 'warning').length;
    const errorCount = promptLog.filter(p => p.category === 'error').length;

    return {
      total,
      successCount,
      warningCount,
      errorCount,
      successRate: total > 0 ? (successCount / total * 100).toFixed(1) : 0
    };
  }

  function createPromptLogModal() {
    const modal = document.createElement('div');
    modal.className = 'prompt-log-modal';
    modal.innerHTML = `
      <div class="prompt-log-overlay">
        <div class="prompt-log-content">
          <div class="prompt-log-header">
            <h2>📝 Prompt History</h2>
            <button class="prompt-log-close">&times;</button>
          </div>
          <div class="prompt-log-stats"></div>
          <div class="prompt-log-entries"></div>
        </div>
      </div>
    `;

    // Close modal when clicking overlay or close button
    modal.querySelector('.prompt-log-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.prompt-log-overlay')) {
        modal.remove();
      }
    });
    modal.querySelector('.prompt-log-close').addEventListener('click', () => modal.remove());

    return modal;
  }

  function renderPromptLog() {
    const modal = createPromptLogModal();
    const statsDiv = modal.querySelector('.prompt-log-stats');
    const entriesDiv = modal.querySelector('.prompt-log-entries');

    // Render stats
    const stats = getPromptStats();
    statsDiv.innerHTML = `
      <div class="prompt-stats">
        <div class="stat-item">
          <span class="stat-label">Total Queries:</span>
          <span class="stat-value">${stats.total}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Success Rate:</span>
          <span class="stat-value">${stats.successRate}%</span>
        </div>
        <div class="stat-item stat-success">
          <span class="stat-label">✅ Success:</span>
          <span class="stat-value">${stats.successCount}</span>
        </div>
        <div class="stat-item stat-warning">
          <span class="stat-label">⚠️ Warning:</span>
          <span class="stat-value">${stats.warningCount}</span>
        </div>
        <div class="stat-item stat-error">
          <span class="stat-label">❌ Error:</span>
          <span class="stat-value">${stats.errorCount}</span>
        </div>
      </div>
    `;

    // Render prompt entries
    if (promptLog.length === 0) {
      entriesDiv.innerHTML = '<div class="no-prompts">No prompts logged yet. Try running some queries!</div>';
    } else {
      entriesDiv.innerHTML = promptLog.map(entry => {
        const date = new Date(entry.timestamp).toLocaleTimeString();
        const confidence = Math.round((entry.validation.confidence || 0) * 100);
        const categoryIcon = {
          success: '✅',
          warning: '⚠️',
          error: '❌'
        }[entry.category];
        const categoryClass = `prompt-category-${entry.category}`;

        return `
          <div class="prompt-entry ${categoryClass}">
            <div class="prompt-header">
              <span class="prompt-time">${date}</span>
              <span class="prompt-confidence">${confidence}% confidence</span>
              <span class="prompt-category">${categoryIcon}</span>
            </div>
            <div class="prompt-text">${entry.prompt}</div>
            <div class="prompt-details">
              ${entry.execution.rowsReturned !== undefined ?
                `<span>📊 ${entry.execution.rowsReturned} results</span>` : ''}
              ${entry.validation.issues && entry.validation.issues.length > 0 ?
                `<span>⚠️ ${entry.validation.issues.join(', ')}</span>` : ''}
              ${entry.execution.error ?
                `<span>❌ ${entry.execution.error}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    document.body.appendChild(modal);
  }

  function isSupportedFile(file) {
    if (!file || !file.name) return false;
    const ext = file.name.split(".").pop().toLowerCase();
    return SUPPORTED_FILE_TYPES.has(ext);
  }

  function handleFileSelection(event) {
    console.log('File selection event triggered');
    console.log('Files selected:', event.target.files);
    const files = Array.from(event.target.files);
    console.log('Files array:', files);
    displaySelectedFiles(files);
  }

  function displaySelectedFiles(files) {
    console.log('displaySelectedFiles called with', files.length, 'files');
    if (files.length === 0) {
      console.log('No files, hiding selected files div');
      if (selectedFilesDiv) selectedFilesDiv.style.display = 'none';
      updateFileStatus('No files selected.', 'warn');
      return;
    }

    console.log('Showing selected files div');
    if (selectedFilesDiv) selectedFilesDiv.style.display = 'block';
    if (selectedFilesList) selectedFilesList.innerHTML = '';

    const unsupportedNames = [];

    files.forEach((file, index) => {
      const li = document.createElement('li');
      const ext = file.name.split('.').pop().toLowerCase();
      const supported = isSupportedFile(file);
      if (!supported) unsupportedNames.push(file.name);

      // Format file size
      const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      // Get file type
      const getFileType = (filename) => {
        const ext = filename.split('.').pop().toLowerCase();
        const typeMap = {
          'csv': 'CSV',
          'json': 'JSON',
          'xlsx': 'Excel',
          'xls': 'Excel'
        };
        return typeMap[ext] || ext.toUpperCase();
      };

      li.innerHTML = `
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-details">${formatFileSize(file.size)} • ${getFileType(file.name)}</div>
          ${supported ? '' : '<div class="file-warning">Unsupported type</div>'}
        </div>
        <button class="file-remove" data-index="${index}" title="Remove file">
          ×
        </button>
      `;

      if (selectedFilesList) selectedFilesList.appendChild(li);
    });

    // Add event listeners for remove buttons
    if (selectedFilesList) {
      selectedFilesList.querySelectorAll('.file-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(btn.getAttribute('data-index'));
          removeFileFromSelection(index);
        });
      });
    }

    if (unsupportedNames.length) {
      updateFileStatus(`Unsupported files will be skipped: ${unsupportedNames.join(', ')}`, 'warn');
    } else {
      updateFileStatus(`${files.length} file(s) ready to import.`, 'ok');
    }
  }

  function updateFileStatus(message, level = 'ok') {
    if (!fileStatusEl) return;
    fileStatusEl.textContent = message;
    fileStatusEl.className = `file-status ${level}`;
    fileStatusEl.style.display = message ? 'block' : 'none';
  }

  function removeFileFromSelection(indexToRemove) {
    const fileInput = document.getElementById("file-input");
    if (!fileInput) return;

    // Create a new FileList without the removed file
    const dt = new DataTransfer();
    const files = Array.from(fileInput.files);

    files.forEach((file, index) => {
      if (index !== indexToRemove) {
        dt.items.add(file);
      }
    });

    // Update the file input
    fileInput.files = dt.files;

    // Update display
    displaySelectedFiles(Array.from(fileInput.files));
  }

  async function main() {
    console.log('DataManager available:', typeof window.DataManager);
    console.log('DataManager.importFiles:', typeof window.DataManager?.importFiles);
    await window.DB.initDB();

    const fileInput = document.getElementById("file-input");
    const btnImport = document.getElementById("btn-import");
    fileStatusEl = document.getElementById("file-status");
    selectedFilesDiv = document.getElementById("selected-files");
    selectedFilesList = document.getElementById("selected-files-list");

    console.log('Element references:');
    console.log('fileInput:', fileInput);
    console.log('selectedFilesDiv:', selectedFilesDiv);
    console.log('selectedFilesList:', selectedFilesList);
    console.log('fileStatusEl:', fileStatusEl);
    const sourcesUl = document.getElementById("sources-ul");
    const schemaPre = document.getElementById("schema-pre");
    const promptInput = document.getElementById("prompt-input");
    const btnRun = document.getElementById("btn-run");
    const btnMicrophone = document.getElementById("btn-microphone");
    console.log('btnMicrophone element:', btnMicrophone);
    const voiceInstruction = document.getElementById("voice-instruction");
    console.log('voiceInstruction element:', voiceInstruction);
    const planPre = document.getElementById("plan-pre");
    const resultsContainer = document.getElementById("results-container");

    // Logo click handler for prompt log
    const logoImg = document.querySelector('.brand img[alt="TRWTH"]');
    if (logoImg) {
      logoImg.style.cursor = 'pointer';
      logoImg.title = 'Click to view prompt history';
      logoImg.addEventListener('click', () => {
        renderPromptLog();
      });
    }

    // Speech recognition setup
    let recognition = null;
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let isAudioRecording = false;

    // Persistent microphone stream to avoid repeated permission prompts
    let persistentMicStream = null;
    let micStreamActive = false;
    // Initialize microphone permission state - use localStorage for file://, sessionStorage for HTTPS
    const useLocalStorage = window.location.protocol === 'file:';
    const storage = useLocalStorage ? localStorage : sessionStorage;

    let micPermissionChecked = storage.getItem('micPermissionChecked') === 'true';
    let micPermissionGranted = storage.getItem('micPermissionGranted') === 'true';
    let micPermissionTimestamp = parseInt(storage.getItem('micPermissionTimestamp') || '0');

    // For file://, add timestamp check (permissions might expire)
    if (useLocalStorage && micPermissionChecked) {
      const now = Date.now();
      const timeDiff = now - micPermissionTimestamp;
      // Reset permission state if it's been more than 1 hour (browsers might forget file:// permissions)
      if (timeDiff > 60 * 60 * 1000) {
        console.log('🔄 File:// permission state expired (1+ hour old), resetting');
        micPermissionChecked = false;
        micPermissionGranted = false;
        storage.removeItem('micPermissionChecked');
        storage.removeItem('micPermissionGranted');
        storage.removeItem('micPermissionTimestamp');
      }
    }

    // Global flag to prevent any microphone access after successful grant
    let microphoneAccessEstablished = micPermissionChecked && micPermissionGranted;

    // Robust microphone permission handling - prevents repeated prompts entirely
    async function requestMicrophonePermission() {
      // ABSOLUTE FIRST CHECK: If microphone access has been successfully established, NEVER check again
      if (microphoneAccessEstablished) {
        console.log('🎯 Microphone access permanently established - no checks ever again');
        return true;
      }

      // Check for cached results
      if (micPermissionChecked) {
        console.log(`📋 Using cached permission result: ${micPermissionGranted ? 'granted' : 'denied'} (${useLocalStorage ? 'localStorage' : 'sessionStorage'})`);
        if (micPermissionGranted) {
          microphoneAccessEstablished = true;
          console.log('🏁 Microphone access now permanently established');
        }
        return micPermissionGranted;
      }

      // Check if we're in file:// environment (more restrictive)
      const isFileProtocol = window.location.protocol === 'file:';
      console.log('📍 Environment check - Protocol:', window.location.protocol, isFileProtocol ? '(file:// - restricted)' : '(HTTP/HTTPS)');

      // Use Permissions API if available (modern browsers) - but be cautious with file://
      if ('permissions' in navigator && !isFileProtocol) {
        try {
          console.log('Checking microphone permission via Permissions API...');
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

          console.log('Microphone permission state:', permissionStatus.state);

          if (permissionStatus.state === 'granted') {
            cachePermissionResult(true);
            microphoneAccessEstablished = true;
            console.log('Microphone permission already granted via Permissions API');
            return true;
          }

          if (permissionStatus.state === 'denied') {
            cachePermissionResult(false);
            console.log('Microphone permission denied via Permissions API');
            return false;
          }

          // Permission state is 'prompt' - we need to request it
          console.log('Microphone permission state is prompt - will request access');
        } catch (err) {
          console.log('Permissions API not supported or failed, falling back to direct request:', err);
          // Fall back to direct request for older browsers or when API fails
          micPermissionChecked = false; // Reset so we try direct request
        }
      } else if (isFileProtocol) {
        console.log('📁 File:// environment detected - using enhanced caching strategy');

        // For file://, try to detect if we previously had permission by attempting a very quick test
        if (!micPermissionChecked) {
          try {
            console.log('🧪 Testing for existing microphone permission...');
            // Try a very quick getUserMedia call (100ms timeout)
            const quickTest = Promise.race([
              navigator.mediaDevices.getUserMedia({ audio: true }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100))
            ]);

            const stream = await quickTest;
            console.log('🎯 Quick test succeeded - permission already granted');
            stream.getTracks().forEach(track => track.stop());
            cachePermissionResult(true);
            microphoneAccessEstablished = true;
            return true;
          } catch (err) {
            if (err.message === 'timeout') {
              console.log('⏱️ Quick test timed out - permission prompt will show');
            } else {
              console.log('❌ Quick test failed - permission likely denied');
              cachePermissionResult(false);
              return false;
            }
          }
        }
      } else {
        console.log('ℹ️ Permissions API not available, using direct request');
      }

      // Request microphone access (will show permission prompt)
      try {
        console.log('Requesting microphone permission via getUserMedia...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Keep the stream alive for future use (don't stop it immediately)
        persistentMicStream = stream;
        micStreamActive = true;

        cachePermissionResult(true);
        microphoneAccessEstablished = true;
        console.log('Microphone permission granted successfully - keeping stream alive');
        return true;
      } catch (err) {
        console.error('Microphone permission request failed:', err);
        cachePermissionResult(false);
        console.log('Microphone permission request failed, marking as denied');
        return false;
      }
    }

    function cachePermissionResult(granted) {
      micPermissionChecked = true;
      micPermissionGranted = granted;
      const timestamp = Date.now();

      storage.setItem('micPermissionChecked', 'true');
      storage.setItem('micPermissionGranted', granted ? 'true' : 'false');
      storage.setItem('micPermissionTimestamp', timestamp.toString());

      console.log(`💾 Cached permission result: ${granted ? 'granted' : 'denied'} (${useLocalStorage ? 'localStorage' : 'sessionStorage'})`);

      if (granted) {
        microphoneAccessEstablished = true;
      }
    }

    // Check for speech recognition support

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      console.log('Speech recognition is supported');

      // For file:// protocol, prefer webkit prefix as it may work better
      let SpeechRecognition;
      if (window.location.protocol === 'file:') {
        SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      } else {
        SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;  // Enable interim results
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;  // Get only the best result

      // Additional settings for file:// protocol compatibility
      if (window.location.protocol === 'file:') {
        try {
          // Some browsers allow these settings for file://
          if ('grammars' in recognition) {
            recognition.grammars = new webkitSpeechGrammarList();
          }
        } catch (e) {
          console.log('Grammar setting not supported');
        }
      }

      recognition.onstart = function() {
        console.log('Speech recognition started');
        isRecording = true;
        btnMicrophone.classList.add('recording');
        btnMicrophone.title = 'Recording... Click to stop';
        if (voiceInstruction) voiceInstruction.style.display = 'block';
      };

      recognition.onresult = function(event) {
        console.log('Speech recognition result:', event);
        let finalTranscript = '';
        let interimTranscript = '';

        // Process all results
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        console.log('Final transcript:', finalTranscript);
        console.log('Interim transcript:', interimTranscript);

        // Only update with final results
        if (finalTranscript) {
          // Replace existing prompt with the new transcript
          promptInput.value = finalTranscript.trim();
          promptInput.focus();
          console.log('Updated text:', promptInput.value);
        }
      };

      recognition.onend = function() {
        console.log('Speech recognition ended');
        isRecording = false;
        btnMicrophone.classList.remove('recording');
        btnMicrophone.title = 'Voice input';
        if (voiceInstruction) voiceInstruction.style.display = 'none';
      };

      recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        isRecording = false;
        btnMicrophone.classList.remove('recording');
        btnMicrophone.title = 'Voice input';
        if (voiceInstruction) voiceInstruction.style.display = 'none';

        let errorMessage = 'Speech recognition error: ';
        switch(event.error) {
          case 'no-speech':
            errorMessage += 'No speech detected. Please speak clearly and try again.';
            break;
          case 'audio-capture':
            errorMessage += 'No microphone found or access denied.';
            break;
          case 'not-allowed':
            errorMessage += 'Microphone access denied. Please allow microphone access and try again.';
            break;
          case 'network':
            errorMessage += 'Network error occurred.';
            break;
          default:
            errorMessage += event.error;
        }
        alert(errorMessage);
      };

      // Enable microphone button
      btnMicrophone.disabled = false;

      // Update button title for file:// protocol
      if (window.location.protocol === 'file:') {
        btnMicrophone.title = 'Voice input (Shift+Click for audio recording)';
      }

      // Add global test functions for debugging
      window.testSpeechRecognition = function() {
        console.log('Testing speech recognition...');
        if (!recognition) {
          console.error('Recognition not available');
          return;
        }
        try {
          recognition.start();
        } catch (error) {
          console.error('Test failed:', error);
        }
      };

      window.testMicrophone = async function() {
        console.log('Testing microphone access...');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log('Microphone access successful!');
          console.log('Audio tracks:', stream.getAudioTracks());
          stream.getTracks().forEach(track => track.stop());
          alert('✅ Microphone access works! The issue might be with speech recognition sensitivity.');
        } catch (error) {
          console.error('Microphone access failed:', error);
          alert('❌ Microphone access failed: ' + error.message);
        }
      };

      // Fallback audio recording for file:// protocol
      const startAudioRecording = async function() {
        if (isAudioRecording) {
          console.log('Stopping audio recording');
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          return;
        }

        console.log('Starting fallback audio recording...');
        isAudioRecording = true;
        btnMicrophone.classList.add('recording');
        if (voiceInstruction) {
          voiceInstruction.textContent = '';
          voiceInstruction.style.display = 'none';
        }

        try {
          // Use persistent stream if available, otherwise this shouldn't happen since permission is checked first
          let stream;
          if (persistentMicStream && micStreamActive) {
            console.log('🎵 Reusing persistent microphone stream for recording');
            stream = persistentMicStream;
          } else {
            console.log('⚠️ No persistent stream available, this should not happen');
            // This is a fallback in case something went wrong
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
              }
            });
            persistentMicStream = stream;
            micStreamActive = true;
          }

          mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
          });

          audioChunks = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            isAudioRecording = false;
            btnMicrophone.classList.remove('recording');
            if (voiceInstruction) voiceInstruction.style.display = 'none';

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            console.log('Audio recording completed:', audioUrl);

            // Create download link
            const a = document.createElement('a');
            a.href = audioUrl;
            a.download = `voice-recording-${new Date().toISOString().split('T')[0]}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // DO NOT stop the persistent stream - keep it alive for future recordings
            // stream.getTracks().forEach(track => track.stop());
            URL.revokeObjectURL(audioUrl);

            // Quiet success for recording
          };

          mediaRecorder.start();
          console.log('Audio recording started');

          // Auto-stop after 10 seconds
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }, 10000);

        } catch (error) {
          console.error('Fallback audio recording failed:', error);
          isAudioRecording = false;
          btnMicrophone.classList.remove('recording');
        if (voiceInstruction) voiceInstruction.style.display = 'none';
          alert('❌ Audio recording failed: ' + error.message);
        }
      };

      window.fallbackAudioRecording = startAudioRecording;
    } else {
      // Disable microphone button if not supported
      btnMicrophone.disabled = true;
      btnMicrophone.title = 'Voice input not supported in this browser';
      btnMicrophone.style.opacity = '0.3';
      btnMicrophone.style.cursor = 'not-allowed';
    }

    // Removed aggressive file:// mic pre-requests to avoid repeated prompts

    sourcesMeta = await window.DataManager.listSources();
    renderSourcesList();

    // File selection event listener
    console.log('Adding file selection event listener');
    fileInput.addEventListener("change", handleFileSelection);
    console.log('File selection event listener added');

    btnImport.addEventListener("click", async () => {
      console.log('Import button clicked');
      try {
        const files = fileInput.files;
        console.log('Files to import:', files);
        console.log('Number of files:', files.length);

        if (!files || !files.length) {
          alert("Select at least one file first.");
          return;
        }

        // Check file types and separate supported/unsupported
        const allFiles = Array.from(files);
        const supportedFiles = allFiles.filter(isSupportedFile);
        const unsupportedFiles = allFiles.filter(f => !isSupportedFile(f));

        console.log('Supported files:', supportedFiles.map(f => f.name));
        console.log('Unsupported files:', unsupportedFiles.map(f => f.name));

        if (unsupportedFiles.length) {
          alert(`These files are not supported and will be skipped: ${unsupportedFiles.map(f => f.name).join(', ')}`);
        }

        if (!supportedFiles.length) {
          alert("No supported files to import. Please choose CSV or JSON files.");
          updateFileStatus('No supported files to import. Please choose CSV or JSON.', 'error');
          return;
        }

        console.log('Calling DataManager.importFiles');
        const imported = await window.DataManager.importFiles(supportedFiles);
        console.log('Import result:', imported);
        console.log('Imported files count:', imported.length);

        sourcesMeta = await window.DataManager.listSources();
        console.log('Updated sources:', sourcesMeta);
        console.log('Sources count:', sourcesMeta.length);

        renderSourcesList();
        fileInput.value = "";
        displaySelectedFiles([]); // Clear UI
        updateFileStatus(`Imported ${imported.length} file(s)`, 'ok');
      } catch (err) {
        console.error('Import error:', err);
        console.error('Error stack:', err.stack);
        updateFileStatus('Import failed: ' + err.message, 'error');
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

    btnMicrophone.addEventListener("click", async (event) => {
      console.log('Microphone button clicked, recognition:', recognition, 'isRecording:', isRecording, 'isAudioRecording:', isAudioRecording);

      // If Shift+Click or we're in file:// and speech recognition failed before, use audio recording
      if ((event.shiftKey || (!recognition && window.location.protocol === 'file:')) && window.location.protocol === 'file:') {
        console.log('Using fallback audio recording');
        await startAudioRecording();
        return;
      }

      // Request microphone permission (only prompts once)
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        updateFileStatus('Microphone permission denied. Please allow access and try again.', 'error');
        return;
      }

      // If we're currently doing audio recording, stop it
      if (isAudioRecording) {
        console.log('Stopping audio recording');
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
        return;
      }

      if (!recognition) {
        if (window.location.protocol === 'file:') {
          alert('Speech recognition not available. Try Shift+Click for audio recording instead.');
        } else {
          alert('Speech recognition is not supported in this browser.');
        }
        return;
      }

      if (isRecording) {
        console.log('Stopping speech recognition');
        recognition.stop();
      } else {
        try {
          console.log('Starting speech recognition');
          recognition.start();
        } catch (error) {
          console.error('Error starting speech recognition:', error);
          // Quiet failure; status already shows mic permission state if denied
        }
      }
    });

    btnRun.addEventListener("click", async () => {
      try {
        const prompt = promptInput.value;
        const parsed = window.NLPEngine.parsePrompt(prompt);

        const planCopy = { ...parsed, conditions: [...parsed.conditions] };

        // Validate query plan before execution
        const validation = await window.QueryEngine.validateQueryPlan(planCopy, sourcesMeta);

        if (!validation.isValid) {
          const issues = validation.issues.join('; ');
          const confidenceMsg = validation.confidence < 0.5 ?
            ` (Low confidence: ${Math.round(validation.confidence * 100)}%)` : '';
          alert(`Query validation failed: ${issues}${confidenceMsg}`);
          return;
        }

        // Show confidence warning if below threshold
        if (validation.confidence < 0.8) {
          const proceed = confirm(
            `This query has ${Math.round(validation.confidence * 100)}% confidence. Proceed anyway?`
          );
          if (!proceed) return;
        }

        // Add validation info to plan display
        planCopy._validation = {
          isValid: validation.isValid,
          confidence: validation.confidence,
          issues: validation.issues
        };

        // Check if multi-source query
        const isMultiSource = planCopy.targetEntities.length > 1;
        
        if (isMultiSource) {
          // Multi-source: find unique ID and columns
          const uniqueId = await window.QueryEngine.findUniqueIdentifierField(sourcesMeta);
          // Restrict valuation detection to the sources matched to the requested entities
          const matchedSources = planCopy.targetEntities
            .map(entity => window.QueryEngine.pickSourceForEntity(entity, sourcesMeta))
            .filter(Boolean);

          // Get valuation field for each source individually, then combine
          const allValuationFields = new Set();
          for (const source of matchedSources) {
            const sourceValuationFields = await window.QueryEngine.identifyValuationFields([source]);
            sourceValuationFields.forEach(field => allValuationFields.add(field));
          }
          const valuationFields = Array.from(allValuationFields);
          
          // For multi-entity queries, only include essential columns:
          // 1. Unique ID for grouping
          // 2. Condition fields (only the primary field for each condition)
          // 3. Valuation fields for comparison

          const conditionFields = new Set();

          // Map each condition to its primary field (not all possible matches)
          for (const condition of planCopy.conditions) {
            let primaryField = null;
            let bestScore = 0;

            // Find the best matching field across all sources for this condition
            for (const entity of planCopy.targetEntities) {
              const source = window.QueryEngine.pickSourceForEntity(entity, sourcesMeta);
              if (source) {
                try {
                  const mapped = await window.ConceptMapper.mapConceptsToFields(source.sourceId, [condition]);
                  // Take the first (best) mapping result
                  if (mapped && mapped.length > 0 && mapped[0].field) {
                    conditionFields.add(mapped[0].field);
                    break; // Use the first valid mapping
                  }
                } catch (err) {
                  // Continue to next source if mapping fails
                }
              }
            }
          }

          // Build columns: uniqueId first, then condition fields, then valuation fields
          const columns = [
            uniqueId,
            ...Array.from(conditionFields).filter(f => f !== uniqueId), // Don't duplicate uniqueId
            ...valuationFields.filter(f => f !== uniqueId) // Don't duplicate uniqueId
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
        
        // Ensure grouping by uniqueID if we have multiple sources or need grouping
        // This should already be handled by executeQueryPlan, but let's verify
        if (result.rows.length > 0 && !result.uniqueId) {
          result.uniqueId = planCopy.uniqueId || await window.QueryEngine.findUniqueIdentifierField(result.usedSources || []);
        }
        
        // Handle function calls (e.g., "average balance of loans")
        if (planCopy.functionCall && result.rows.length > 0 && result.usedSources && result.usedSources.length > 0) {
          const source = result.usedSources[0];
          const library = window.FunctionLibrary[planCopy.functionCall.library];
          if (library && library.functions[planCopy.functionCall.functionName]) {
            const functionInfo = library.functions[planCopy.functionCall.functionName];
            
            // Get uniqueID from result or query plan
            const uniqueId = result.uniqueId || planCopy.uniqueId || await window.QueryEngine.findUniqueIdentifierField(result.usedSources || []);
            
            // Map function parameters to field names
            const fieldMapping = await window.FunctionRegistry.mapFunctionParameters(
              source.sourceId,
              functionInfo
            );
            
            // Get parameter names for column headers
            const paramNames = window.FunctionRegistry.getFunctionParameters(functionInfo);
            const resultColumnName = planCopy.functionCall.functionName.replace(/([A-Z])/g, ' $1').trim();
            
            // Build column list: uniqueID first, then function parameters, then result column
            const functionColumns = [];
            if (uniqueId) {
              functionColumns.push(uniqueId);
            }
            for (const param of paramNames) {
              const fieldName = fieldMapping[param];
              if (fieldName) {
                functionColumns.push(fieldName);
              }
            }
            functionColumns.push(resultColumnName);
            
            // Execute function on each row and add result as new column
            // Handle both regular rows and aggregated rows with sub-rows
            const enrichedRows = [];
            for (const row of result.rows) {
              const enrichedRow = { ...row };
              
              // Execute function on main row
              const funcResult = window.FunctionRegistry.executeFunctionOnRow(
                row,
                functionInfo,
                fieldMapping
              );
              
              if (funcResult != null) {
                enrichedRow[resultColumnName] = funcResult;
              }
              
              // If row has sub-rows (aggregated), apply function to sub-rows too
              if (row._subRows && row._subRows.length > 0) {
                enrichedRow._subRows = row._subRows.map(subRow => {
                  const enrichedSubRow = { ...subRow };
                  const subFuncResult = window.FunctionRegistry.executeFunctionOnRow(
                    subRow,
                    functionInfo,
                    fieldMapping
                  );
                  if (subFuncResult != null) {
                    enrichedSubRow[resultColumnName] = subFuncResult;
                  }
                  return enrichedSubRow;
                });
              }
              
              enrichedRows.push(enrichedRow);
            }
            
            // Update result rows and render as table
            result.rows = enrichedRows;
            result.uniqueId = uniqueId;
            planCopy.columns = functionColumns;
            planCopy.uniqueId = uniqueId;
            planCopy.valuationFields = [resultColumnName];
            
            // Continue to normal rendering with enriched rows
          }
        }
        
        // Handle statistical operations
        if (planCopy.statisticalOp && planCopy.statisticalField) {
          // Find the actual field name using concept mapper
          let statisticalFieldName = planCopy.statisticalField;
          
          if (result.usedSources && result.usedSources.length > 0) {
            const source = result.usedSources[0];
            const schema = await window.DataManager.getSchema(source.sourceId);
            if (schema && schema.fields) {
              // Try to map the statistical field using concept mapper
              const tempCondition = {
                concept: planCopy.statisticalField,
                valueType: "number"
              };
              const mapped = await window.ConceptMapper.mapConceptsToFields(
                source.sourceId,
                [tempCondition]
              );
              if (mapped[0] && mapped[0].field) {
                statisticalFieldName = mapped[0].field;
              } else {
                // Try direct field name match
                const directMatch = schema.fields.find(f => 
                  f.name.toLowerCase().includes(planCopy.statisticalField.toLowerCase()) ||
                  f.id.toLowerCase().includes(planCopy.statisticalField.toLowerCase())
                );
                if (directMatch) {
                  statisticalFieldName = directMatch.id;
                }
              }
            }
          }
          
          // Apply statistical operation
          const statResult = window.Statistical.applyStatisticalOperation(
            result.rows,
            statisticalFieldName,
            planCopy.statisticalOp
          );
          
          if (statResult != null) {
            const formatted = window.Statistical.formatStatisticalResult(
              planCopy.statisticalOp,
              statResult,
              statisticalFieldName
            );
            
            // Display statistical result
            resultsContainer.innerHTML = `
              <div class="statistical-result">
                <h3>Statistical Result</h3>
                <div class="stat-value">
                  <span class="stat-operation">${formatted.operation}</span>
                  <span class="stat-field">of ${formatted.field}</span>
                  <span class="stat-number">${formatted.value}</span>
                </div>
                <div class="stat-meta">
                  Based on ${result.rows.length} row${result.rows.length !== 1 ? 's' : ''}
                </div>
              </div>
            `;
            return;
          }
        }
        
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

        // Log successful prompt execution
        logPrompt(prompt, parsed, validation, {
          success: true,
          rowsReturned: result.rows ? result.rows.length : 0,
          error: null
        });
      } catch (err) {
        console.error(err);

        // Log failed prompt execution
        logPrompt(prompt, parsed, validation, {
          success: false,
          rowsReturned: 0,
          error: err.message
        });

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
            </div>
            <div class="source-item-actions">
              <button class="btn-icon btn-update" title="Update source with new file (select file again to refresh schema)" data-action="update" data-source-id="${src.sourceId}">
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
    
    // Ensure uniqueID is first column if it exists
    const uniqueIdField = queryPlan?.uniqueId;
    if (uniqueIdField) {
      if (columns.includes(uniqueIdField)) {
        // Move uniqueID to first position
        columns = columns.filter(c => c !== uniqueIdField);
        columns.unshift(uniqueIdField);
      } else {
        // Add uniqueID as first column if it's not already there
        columns.unshift(uniqueIdField);
      }
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
    // Use uniqueIdField from above, or fallback to first column
    const uniqueIdForGrouping = uniqueIdField || columns[0];

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

    // Cleanup microphone stream when page unloads
    window.addEventListener('beforeunload', () => {
      if (persistentMicStream && micStreamActive) {
        console.log('🧹 Cleaning up persistent microphone stream');
        persistentMicStream.getTracks().forEach(track => track.stop());
        persistentMicStream = null;
        micStreamActive = false;
      }
    });

    // kick off once DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", main);
    } else {
      main();
    }
})();
