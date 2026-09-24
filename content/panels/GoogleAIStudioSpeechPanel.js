window.GoogleAIStudioSpeechPanel = class extends window.BasePanel {
  constructor(onClose) {
    super({
      id: "google-ai-studio-speech-panel",
      title: "Speech Settings",
      icon: window.CHIcons ? window.CHIcons.mic({ size: 20 }) : "🎙️",
      onClose: onClose,
      view: window.GoogleAIStudioSpeechView
    });
    // Dùng chung storageKey với bản cũ để giữ nguyên data user
    this.storageKey = 'google_ai_studio_profiles';
    this.profiles = {};
    this.activeProfileName = 'default';

    this.attachEvents();
    this.loadProfiles();
    GoogleAIStudioSpeechPanel.startRealtimePromptWatcher();
  }

  attachEvents() {
    this.el.querySelector('#save-settings-btn').addEventListener('click', () => this.saveCurrentProfile());
    this.el.querySelector('#apply-to-page-btn')?.addEventListener('click', async () => {
      const currentData = this.collectDataFromForm();
      ContentHelper.showToast("⏳ Đang điền cấu hình vào trang AI Studio...", "info");
      await GoogleAIStudioSpeechPanel.setValueScript(currentData);
      ContentHelper.showToast("✅ Đã điền cấu hình vào trang!", "success");
    });
    this.el.querySelector('#btn-swap-speakers')?.addEventListener('click', () => {
      this.swapSpeakers();
    });
    this.el.querySelector('#save-as-new-btn').addEventListener('click', () => {
      this.saveAsNewProfile();
      this.el.querySelector('#gaisp-new-profile-group').classList.add('hidden');
    });
    this.el.querySelector('#gaisp-new-profile').addEventListener('click', () => {
      const group = this.el.querySelector('#gaisp-new-profile-group');
      group.classList.toggle('hidden');
      if (!group.classList.contains('hidden')) {
        const input = this.el.querySelector('#new-profile-name');
        input.value = '';
        input.focus();
      }
    });
    this.el.querySelector('#gaisp-delete-profile').addEventListener('click', () => this.deleteSelectedProfile());

    // Custom Dropdown Logic
    const trigger = this.el.querySelector('#profile-dropdown-trigger');
    const menu = this.el.querySelector('#profile-dropdown-menu');
    const container = this.el.querySelector('#profile-dropdown-container');

    if (trigger && menu) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden-dropdown');
      });

      this._onDocClick = (event) => {
        const path = event.composedPath ? event.composedPath() : [];
        if (!path.includes(container)) {
          menu.classList.add('hidden-dropdown');
        }
      };
      document.addEventListener('click', this._onDocClick);
    }
  }

  /**
   * Hoán đổi nhanh vị trí Speaker 1 ⇄ Speaker 2 (và Voice 1 ⇄ Voice 2)
   */
  swapSpeakers() {
    const spk1Input = this.el.querySelector('#input-value1');
    const spk2Input = this.el.querySelector('#input-value2');
    const voice1Input = this.el.querySelector('#voice1');
    const voice2Input = this.el.querySelector('#voice2');

    if (!spk1Input || !spk2Input || !voice1Input || !voice2Input) return;

    const tempSpk = spk1Input.value;
    spk1Input.value = spk2Input.value;
    spk2Input.value = tempSpk;

    const tempVoice = voice1Input.value;
    voice1Input.value = voice2Input.value;
    voice2Input.value = tempVoice;

    ContentHelper.playHapticFeedback?.(8);
    ContentHelper.showToast('Đã hoán đổi vị trí Speaker 1 ⇄ Speaker 2!', 'info');
  }

  loadProfiles() {
    chrome.storage.local.get([this.storageKey, "google_user_email"], async (items) => {
      const userId = items.google_user_email;
      let localData = items[this.storageKey] || {};

      if (userId) {
        console.log("☁️ [SpeechPanel] Attempting to load profiles from Firestore...");
        const helper = new FirestoreHelper(firebaseConfig);
        helper.collection = 'speech_profiles';
        try {
          const firestoreData = await helper.loadUserConfig(userId);
          if (firestoreData && firestoreData.profiles) {
            console.log("☁️ Loaded profiles from Firestore.");
            localData = firestoreData;
            chrome.storage.local.set({ [this.storageKey]: firestoreData });
          }
        } catch (err) {
          console.error("❌ Error loading profiles from Firestore:", err);
        }
      }

      this.profiles = localData.profiles || { 'default': {} };
      this.activeProfileName = localData.activeProfileName || 'default';
      this.updateProfileDropdown();
      this.fillFormWithProfile(this.activeProfileName);
    });
  }

  updateProfileDropdown() {
    const trigger = this.el.querySelector('#profile-selected-text');
    const menu = this.el.querySelector('#profile-dropdown-menu');

    if (!trigger || !menu) return;

    trigger.textContent = this.activeProfileName;
    menu.innerHTML = '';

    Object.keys(this.profiles).forEach(name => {
      const item = document.createElement('div');
      item.className = `custom-dropdown-item scenario-dropdown-item ts-item-row ${name === this.activeProfileName ? 'selected' : ''}`;
      item.innerHTML = `
        <span class="ts-group-tag">PROFILE</span>
        <span class="ts-item-row__text font-bold">${name}</span>
        ${name === this.activeProfileName ? '<span class="ts-selected-check font-bold">✓</span>' : ''}
      `;
      item.onclick = () => {
        this.switchProfile(name);
        menu.classList.add('hidden-dropdown');
      };
      menu.appendChild(item);
    });
  }

  fillFormWithProfile(profileName) {
    const profileData = this.profiles[profileName] || {};
    this.el.querySelector('#input-value1').value = profileData.InputValue1 || '';
    this.el.querySelector('#input-value2').value = profileData.InputValue2 || '';
    this.el.querySelector('#voice1').value = profileData.Voice1 || '';
    this.el.querySelector('#voice2').value = profileData.Voice2 || '';

    // Tương thích ngược: ưu tiên key mới (scene, sampleContext), fallback sang key cũ
    const sceneVal = profileData.scene !== undefined ? profileData.scene : (profileData.sceneInstructions || '');
    const sampleContextVal = profileData.sampleContext !== undefined ? profileData.sampleContext : (profileData.styleInstructions || '');

    const sceneEl = this.el.querySelector('#scene-instructions');
    if (sceneEl) sceneEl.value = sceneVal;

    const sampleContextEl = this.el.querySelector('#sample-context-instructions') || this.el.querySelector('#style-instructions');
    if (sampleContextEl) sampleContextEl.value = sampleContextVal;

    const autoPasteEl = this.el.querySelector('#auto-paste-clipboard');
    if (autoPasteEl) autoPasteEl.checked = profileData.autoPasteClipboard || false;
  }

  switchProfile(profileName) {
    this.activeProfileName = profileName;
    this.fillFormWithProfile(profileName);
    this.updateProfileDropdown();
    this.saveAllDataToStorage();
  }

  collectDataFromForm() {
    const sceneEl = this.el.querySelector('#scene-instructions');
    const sampleContextEl = this.el.querySelector('#sample-context-instructions') || this.el.querySelector('#style-instructions');
    const sceneVal = sceneEl ? sceneEl.value : '';
    const sampleContextVal = sampleContextEl ? sampleContextEl.value : '';

    return {
      InputValue1: this.el.querySelector('#input-value1')?.value || '',
      InputValue2: this.el.querySelector('#input-value2')?.value || '',
      Voice1: this.el.querySelector('#voice1')?.value || '',
      Voice2: this.el.querySelector('#voice2')?.value || '',
      scene: sceneVal,
      sampleContext: sampleContextVal,
      // Lưu song song key cũ để tương thích với dữ liệu và Firestore đã có
      sceneInstructions: sceneVal,
      styleInstructions: sampleContextVal,
      autoDetectSpeakerOrder: true,
      autoSetValue: true,
      autoPasteClipboard: this.el.querySelector('#auto-paste-clipboard')?.checked || false,
    };
  }

  saveAllDataToStorage(callback) {
    const dataToSave = {
      profiles: this.profiles,
      activeProfileName: this.activeProfileName,
    };
    chrome.storage.local.set({ [this.storageKey]: dataToSave }, callback);
  }

  saveCurrentProfile() {
    const currentData = this.collectDataFromForm();
    this.profiles[this.activeProfileName] = currentData;
    this.saveAllDataToStorage(async () => {
      ContentHelper.showToast(`Profile "${this.activeProfileName}" đã được lưu!`, "success");
      this._syncToFirestore();

      // Tự động điền ngay vào trang web AI Studio nếu đang ở trang speech
      if (window.location.pathname.includes('/generate-speech')) {
        console.log("🚀 [SpeechPanel] Tự động áp dụng giá trị profile vào trang ngay sau khi lưu...");
        await GoogleAIStudioSpeechPanel.setValueScript(currentData);
      }
    });
  }

  saveAsNewProfile() {
    const newName = this.el.querySelector('#new-profile-name').value.trim();
    if (!newName) {
      ContentHelper.showToast("Vui lòng nhập tên cho profile mới.", "warning");
      return;
    }
    if (this.profiles[newName]) {
      ContentHelper.showToast("Tên profile này đã tồn tại.", "warning");
      return;
    }
    this.profiles[newName] = this.collectDataFromForm();
    this.activeProfileName = newName;
    this.saveAllDataToStorage(() => {
      ContentHelper.showToast(`Đã lưu profile mới: "${newName}"`, "success");
      this.el.querySelector('#new-profile-name').value = '';
      this.updateProfileDropdown();
      this._syncToFirestore();
    });
  }

  deleteSelectedProfile() {
    const profileToDelete = this.activeProfileName;
    if (Object.keys(this.profiles).length <= 1) {
      ContentHelper.showToast("Không thể xóa profile cuối cùng.", "warning");
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa profile "${profileToDelete}"?`)) {
      delete this.profiles[profileToDelete];
      this.activeProfileName = Object.keys(this.profiles)[0];
      this.saveAllDataToStorage(() => {
        ContentHelper.showToast(`Đã xóa profile: "${profileToDelete}"`, "success");
        this.updateProfileDropdown();
        this.fillFormWithProfile(this.activeProfileName);
        this._syncToFirestore();
      });
    }
  }

  destroy() {
    this.el?.remove();
    this.onClose?.();
  }

  // =================================================================
  // STATIC HELPERS FOR NEW AI STUDIO UI
  // =================================================================

  static triggerAutoSet() {
    const storageKey = 'google_ai_studio_profiles';
    chrome.storage.local.get([storageKey], async (result) => {
      const data = result[storageKey] || {};
      const activeProfileName = data.activeProfileName || 'default';
      const activeProfile = (data.profiles || {})[activeProfileName];

      // Auto Set luôn bật theo cấu hình mặc định của hệ thống
      if (activeProfile && activeProfile.autoSetValue !== false) {
        console.log(`✅ [SpeechPanel] Auto Set enabled for profile "${activeProfileName}". Running script...`);

        // Bước 1: Tìm và click thẻ "The Energetic Co-Host"
        const cardClicked = await GoogleAIStudioSpeechPanel.clickPodcastCard();
        if (cardClicked) {
          console.log("⏳ [SpeechPanel] Waiting for the new UI to load...");
          await new Promise(r => setTimeout(r, 2000));
        }

        // Đọc trước clipboard nếu có bật autoPasteClipboard để phát hiện thứ tự speaker
        let clipboardText = '';
        if (activeProfile.autoPasteClipboard && navigator.clipboard?.readText) {
          try {
            clipboardText = await navigator.clipboard.readText();
          } catch (e) {
            console.warn("⚠️ [SpeechPanel] Không thể đọc trước clipboard:", e);
          }
        }

        // Bước 2: Điền cấu hình vào trang (truyền clipboardText để tự động đảo speaker nếu speaker 2 nói trước)
        await GoogleAIStudioSpeechPanel.setValueScript(activeProfile, clipboardText);

        // Bước cuối: Tự động dán clipboard nếu option được bật
        if (activeProfile.autoPasteClipboard) {
          console.log(`📋 [SpeechPanel] Auto Paste Clipboard enabled. Running paste script...`);
          await GoogleAIStudioSpeechPanel.autoPasteClipboardToPrompt(clipboardText);
        } else {
          console.log(`ℹ️ Auto Paste Clipboard is disabled for profile "${activeProfileName}".`);
        }
        // Bước tiếp theo: Kích hoạt realtime watcher lắng nghe ô Text prompt
        GoogleAIStudioSpeechPanel.startRealtimePromptWatcher();
      } else {
        console.log(`ℹ️ Auto Set is disabled for profile "${activeProfileName}".`);
      }
    });
  }

  static async clickPodcastCard(timeoutMs = 4000) {
    // Nếu trang đã ở trong giao diện soạn thảo thoại (đã có ms-voice-settings), không cần click card nữa
    if (document.querySelector('ms-voice-settings, ms-speech-editor')) {
      console.log("ℹ️ [SpeechPanel] Đã ở trong giao diện Speech Editor. Bỏ qua click card.");
      return false;
    }

    console.log("🔍 [SpeechPanel] Bắt đầu tìm thẻ 'The Energetic Co-Host'...");
    const startTime = Date.now();

    return new Promise((resolve) => {
      const pollInterval = setInterval(() => {
        let targetCard = null;

        // Tầng 1: Tìm theo tiêu đề (h3.card-title, .card-title, .title-text)
        const titleCandidates = Array.from(document.querySelectorAll('.card-title, h3, .title-text, [data-testid="dialog-example-card"] h3'));
        const matchedTitle = titleCandidates.find(el => (el.textContent || '').trim().toLowerCase() === 'the energetic co-host');

        if (matchedTitle) {
          targetCard = matchedTitle.closest('mat-card, [data-testid="dialog-example-card"], .dialog-example-card, mat-card-content')
            || matchedTitle.closest('.display-media-container')?.parentElement;
        }

        // Tầng 2: Tìm theo container mat-card chứa text 'The Energetic Co-Host'
        if (!targetCard) {
          const allCards = Array.from(document.querySelectorAll('mat-card, [data-testid="dialog-example-card"], .dialog-example-card'));
          targetCard = allCards.find(card => {
            const txt = (card.textContent || '').toLowerCase();
            return txt.includes('the energetic co-host');
          });
        }

        // Tầng 3: Fallback tìm theo icon 'podcasts' hoặc mô tả 'podcast style conversation'
        if (!targetCard) {
          const allCards = Array.from(document.querySelectorAll('mat-card, [data-testid="dialog-example-card"], .dialog-example-card'));
          targetCard = allCards.find(card => {
            const iconText = card.querySelector('.dialog-icon')?.textContent?.trim()?.toLowerCase();
            const txt = (card.textContent || '').toLowerCase();
            return iconText === 'podcasts' || txt.includes('podcast style conversation');
          });
        }

        if (targetCard) {
          clearInterval(pollInterval);
          console.log("✅ [SpeechPanel] Tìm thấy thẻ 'The Energetic Co-Host'. Đang kích hoạt click...", targetCard);

          // Tránh click trúng nút play audio preview (.play-audio-button)
          const clickTarget = targetCard.querySelector('.card-text-content, .card-title') || targetCard;
          try {
            clickTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          } catch (_) {}

          // Kích hoạt click native và MouseEvent để Angular Material xử lý sự kiện
          clickTarget.click();
          try {
            clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch (_) {}

          if (clickTarget !== targetCard) {
            try {
              targetCard.click();
            } catch (_) {}
          }

          return resolve(true);
        }

        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(pollInterval);
          console.log("ℹ️ [SpeechPanel] Timeout: Không tìm thấy thẻ 'The Energetic Co-Host'. Tiếp tục các bước sau...");
          return resolve(false);
        }
      }, 150);
    });
  }

  /**
   * Tự động phát hiện speaker nào xuất hiện đầu tiên trong đoạn văn bản thoại.
   * Ưu tiên nhận diện cấu trúc dòng thoại: "Tên:", "Tên：", v.v.
   * @param {string} text - Văn bản kịch bản hội thoại
   * @param {string} speaker1 - Tên Speaker 1 (vd: "春樹")
   * @param {string} speaker2 - Tên Speaker 2 (vd: "結衣")
   * @returns {1|2} 1 nếu Speaker 1 nói trước (hoặc mặc định), 2 nếu Speaker 2 nói trước
   */
  static detectSpeakerOrder(text, speaker1, speaker2) {
    if (!text || typeof text !== 'string') return 1;
    const s1 = (speaker1 || '').trim();
    const s2 = (speaker2 || '').trim();
    if (!s1 || !s2 || s1.toLowerCase() === s2.toLowerCase()) return 1;

    const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Tìm speaker ở đầu dòng hoặc trước dấu hai chấm (: hoặc ： fullwidth)
    // Hỗ trợ cả emotion tag đứng trước [excited] Tên: hoặc tên phụ sau [Tên (Haruki):]
    const pattern1 = `(?:^|\\n)\\s*(?:\\[[^\\]]+\\]\\s*)?${escapeReg(s1)}(?:\\s*\\([^)]+\\))?\\s*[:：]`;
    const pattern2 = `(?:^|\\n)\\s*(?:\\[[^\\]]+\\]\\s*)?${escapeReg(s2)}(?:\\s*\\([^)]+\\))?\\s*[:：]`;

    const reg1 = new RegExp(pattern1, 'i');
    const reg2 = new RegExp(pattern2, 'i');

    const match1 = text.match(reg1);
    const match2 = text.match(reg2);

    const idx1 = match1 ? match1.index : -1;
    const idx2 = match2 ? match2.index : -1;

    if (idx1 !== -1 && idx2 !== -1) {
      console.log(`🔍 [SpeechPanel] Phát hiện dòng thoại: "${s1}" ở index ${idx1}, "${s2}" ở index ${idx2}`);
      return idx1 < idx2 ? 1 : 2;
    }
    if (idx1 !== -1) return 1;
    if (idx2 !== -1) return 2;

    // 2. Fallback: Nếu không có dấu hai chấm, tìm vị trí xuất hiện đầu tiên của từ tên
    const pos1 = text.indexOf(s1);
    const pos2 = text.indexOf(s2);
    if (pos1 !== -1 && pos2 !== -1) {
      console.log(`🔍 [SpeechPanel] Vị trí xuất hiện: "${s1}" (${pos1}) vs "${s2}" (${pos2})`);
      return pos1 < pos2 ? 1 : 2;
    }
    if (pos2 !== -1 && pos1 === -1) return 2;

    return 1;
  }

  /**
   * Lấy tên Speaker hiện tại đang có trong Slot chỉ định (0 hoặc 1).
   * @param {number} slotIndex - 0 hoặc 1
   * @returns {string}
   */
  static getCurrentSpeakerInSlot(slotIndex) {
    const allVoiceSettings = document.querySelectorAll('ms-voice-settings');
    if (slotIndex < allVoiceSettings.length) {
      const input = allVoiceSettings[slotIndex].querySelector('input[aria-label="Speaker name"], input.speaker-alias-input');
      return input ? input.value.trim() : '';
    }
    return '';
  }

  /**
   * Bắt đầu lắng nghe tự động thay đổi trong ô Text prompt theo thời gian thực (Realtime Watcher).
   * Khi người dùng nhập hoặc dán kịch bản, tự động phân tích speaker nào nói trước và đảo thứ tự Speaker & Voice.
   */
  static startRealtimePromptWatcher() {
    if (GoogleAIStudioSpeechPanel._isWatcherInitialized) return;
    GoogleAIStudioSpeechPanel._isWatcherInitialized = true;

    console.log("👀 [SpeechPanel] Khởi tạo Realtime Prompt Watcher...");

    const attachToTextarea = (ta) => {
      if (!ta || ta._chSpeechWatched) return;
      ta._chSpeechWatched = true;
      console.log("🎯 [SpeechPanel] Đã gắn Realtime Listener vào ô Text prompt:", ta);

      const handleInput = () => {
        clearTimeout(GoogleAIStudioSpeechPanel._debounceTimer);
        GoogleAIStudioSpeechPanel._debounceTimer = setTimeout(async () => {
          await GoogleAIStudioSpeechPanel.handlePromptChange(ta.value);
        }, 500);
      };

      ta.addEventListener('input', handleInput);
      ta.addEventListener('paste', handleInput);
    };

    // 1. Thử gắn ngay nếu textarea đã có trên DOM
    const currentTa = GoogleAIStudioSpeechPanel.getPromptTextarea();
    if (currentTa) {
      attachToTextarea(currentTa);
    }

    // 2. Sử dụng MutationObserver để tự động bắt kịp khi ô textarea xuất hiện (khi chuyển tab hoặc sau khi load)
    try {
      const observer = new MutationObserver(() => {
        const ta = GoogleAIStudioSpeechPanel.getPromptTextarea();
        if (ta && !ta._chSpeechWatched) {
          attachToTextarea(ta);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      GoogleAIStudioSpeechPanel._promptObserver = observer;
    } catch (e) {
      console.warn("⚠️ [SpeechPanel] Không thể khởi tạo MutationObserver cho Prompt Watcher:", e);
    }
  }

  /**
   * Xử lý khi nội dung prompt thay đổi theo thời gian thực (Debounced)
   * @param {string} text - Nội dung kịch bản hiện tại trong prompt
   */
  static async handlePromptChange(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return;

    // Tránh re-entrance khi đang trong quá trình cập nhật
    if (GoogleAIStudioSpeechPanel._isHandlingPromptChange) return;

    const storageKey = 'google_ai_studio_profiles';
    chrome.storage.local.get([storageKey], async (result) => {
      const data = result[storageKey] || {};
      const activeProfileName = data.activeProfileName || 'default';
      const activeProfile = (data.profiles || {})[activeProfileName];
      if (!activeProfile) return;

      const spk1 = (activeProfile.InputValue1 || '').trim();
      const spk2 = (activeProfile.InputValue2 || '').trim();
      const voice1 = (activeProfile.Voice1 || '').trim();
      const voice2 = (activeProfile.Voice2 || '').trim();

      if (!spk1 || !spk2) return;

      const detectedFirst = GoogleAIStudioSpeechPanel.detectSpeakerOrder(text, spk1, spk2);
      const targetSlot0Spk = detectedFirst === 2 ? spk2 : spk1;
      const targetSlot0Voice = detectedFirst === 2 ? voice2 : voice1;
      const targetSlot1Spk = detectedFirst === 2 ? spk1 : spk2;
      const targetSlot1Voice = detectedFirst === 2 ? voice1 : voice2;

      // Lấy tên Speaker hiện tại đang có ở Slot 0
      const currentSlot0Spk = GoogleAIStudioSpeechPanel.getCurrentSpeakerInSlot(0);

      // Nếu slot 0 đã khớp với Speaker mục tiêu thì không cần đảo lại
      if (currentSlot0Spk && currentSlot0Spk.toLowerCase() === targetSlot0Spk.toLowerCase()) {
        return;
      }

      try {
        GoogleAIStudioSpeechPanel._isHandlingPromptChange = true;
        console.log(`🔄 [SpeechPanel Realtime] Phát hiện "${targetSlot0Spk}" nói trước. Tự động cập nhật Speaker 0 ⇄ 1...`);
        if (typeof ContentHelper !== 'undefined') {
          ContentHelper.showToast?.(`Phát hiện "${targetSlot0Spk}" nói trước, tự động đổi vị trí Thẻ giọng!`, 'info');
        }

        // Cập nhật tên Speaker
        await GoogleAIStudioSpeechPanel.setSpeakerName(0, targetSlot0Spk);
        await GoogleAIStudioSpeechPanel.setSpeakerName(1, targetSlot1Spk);

        // Cập nhật Voice tương ứng
        if (targetSlot0Voice) {
          await GoogleAIStudioSpeechPanel.selectVoice(0, targetSlot0Voice);
        }
        if (targetSlot1Voice) {
          await GoogleAIStudioSpeechPanel.selectVoice(1, targetSlot1Voice);
        }
      } catch (err) {
        console.warn("⚠️ [SpeechPanel Realtime] Lỗi khi đổi vị trí Speaker:", err);
      } finally {
        GoogleAIStudioSpeechPanel._isHandlingPromptChange = false;
      }
    });
  }

  static async setValueScript(settings, explicitText = null) {
    console.log("🚀 [SpeechPanel] start setValueScript: ", settings);

    // BƯỚC 1: Ưu tiên số 1 - Cập nhật Scene & Sample Context trước tiên (không phụ thuộc vào việc chọn giọng)
    const sceneText = settings.scene !== undefined ? settings.scene : (settings.sceneInstructions || '');
    if (sceneText) {
      try {
        console.log("📝 [SpeechPanel] Đang điền Scene...");
        await GoogleAIStudioSpeechPanel.setTextareaValueByLabel('Scene', sceneText);
      } catch (e) {
        console.warn("⚠️ [SpeechPanel] Lỗi điền Scene:", e);
      }
    }

    const sampleContextText = settings.sampleContext !== undefined ? settings.sampleContext : (settings.styleInstructions || '');
    if (sampleContextText) {
      try {
        console.log("📝 [SpeechPanel] Đang điền Sample Context...");
        await GoogleAIStudioSpeechPanel.setTextareaValueByLabel('Sample Context', sampleContextText);
      } catch (e) {
        console.warn("⚠️ [SpeechPanel] Lỗi điền Sample Context:", e);
      }
    }

    // BƯỚC 2: Tự động phân tích thứ tự Speaker xuất hiện trong kịch bản thoại
    let slot0Speaker = settings.InputValue1 || '';
    let slot0Voice = settings.Voice1 || '';
    let slot1Speaker = settings.InputValue2 || '';
    let slot1Voice = settings.Voice2 || '';

    // Tự động phát hiện thứ tự Speaker xuất hiện trong kịch bản thoại (luôn bật)
    const shouldAutoDetect = true;

    if (shouldAutoDetect && slot0Speaker && slot1Speaker) {
      let promptText = explicitText || '';

      // Thử đọc từ ô textarea prompt nếu đã có sẵn text trên trang AI Studio
      if (!promptText) {
        const ta = GoogleAIStudioSpeechPanel.getPromptTextarea();
        if (ta && ta.value && ta.value.trim()) {
          promptText = ta.value;
        }
      }

      // Thử đọc từ clipboard nếu được cấp quyền và chưa có text
      if (!promptText && settings.autoPasteClipboard && navigator.clipboard?.readText) {
        try {
          promptText = await navigator.clipboard.readText();
        } catch (_) {}
      }

      if (promptText) {
        const firstSpeaker = GoogleAIStudioSpeechPanel.detectSpeakerOrder(promptText, settings.InputValue1, settings.InputValue2);
        if (firstSpeaker === 2) {
          console.log(`🔄 [SpeechPanel] Phát hiện Speaker 2 ("${settings.InputValue2}") nói trước Speaker 1 ("${settings.InputValue1}"). Tự động đảo Thẻ giọng 0 và 1!`);
          if (typeof ContentHelper !== 'undefined') {
            ContentHelper.showToast(`Phát hiện "${settings.InputValue2}" nói trước, đã tự động xếp vào Thẻ giọng 1!`, 'info');
          }
          slot0Speaker = settings.InputValue2 || '';
          slot0Voice = settings.Voice2 || '';
          slot1Speaker = settings.InputValue1 || '';
          slot1Voice = settings.Voice1 || '';
        } else {
          console.log(`✅ [SpeechPanel] Speaker 1 ("${settings.InputValue1}") nói trước hoặc theo thứ tự mặc định.`);
        }
      }
    }

    // BƯỚC 3: Cập nhật tên Speaker theo đúng thứ tự slot đã tính toán
    try {
      if (slot0Speaker) {
        await GoogleAIStudioSpeechPanel.setSpeakerName(0, slot0Speaker);
      }
      if (slot1Speaker) {
        await GoogleAIStudioSpeechPanel.setSpeakerName(1, slot1Speaker);
      }
    } catch (e) {
      console.warn("⚠️ [SpeechPanel] Lỗi set Speaker Name:", e);
    }

    // BƯỚC 4: Chọn Voice 1 và Voice 2 tương ứng cho từng Slot
    try {
      if (slot0Voice) {
        await GoogleAIStudioSpeechPanel.selectVoice(0, slot0Voice);
      }
    } catch (e) {
      console.warn(`⚠️ [SpeechPanel] Không thể chọn Voice Slot 0 (${slot0Voice}):`, e);
    }

    try {
      if (slot1Voice) {
        await GoogleAIStudioSpeechPanel.selectVoice(1, slot1Voice);
      }
    } catch (e) {
      console.warn(`⚠️ [SpeechPanel] Không thể chọn Voice Slot 1 (${slot1Voice}):`, e);
    }

    console.log("✅ [SpeechPanel] Hoàn tất setValueScript.");
  }

  /**
   * Chọn giọng nói cho một Speaker cụ thể dựa trên Dialog Speaker settings của AI Studio.
   * @param {number} speakerIndex - Chỉ số của speaker (0 hoặc 1).
   * @param {string} voiceName - Tên của giọng nói cần chọn.
   * @param {number} timeoutMs - Thời gian timeout (mặc định 8000ms).
   */
  static selectVoice(speakerIndex, voiceName, timeoutMs = 8000) {
    return new Promise(async (resolve) => {
      if (!voiceName || !voiceName.trim()) {
        return resolve(false);
      }

      const cleanVoiceName = voiceName.trim();
      console.log(`🎙️ [SpeechPanel] Bắt đầu chọn giọng "${cleanVoiceName}" cho Speaker index ${speakerIndex}...`);

      const startTime = Date.now();
      const findSettingInterval = setInterval(async () => {
        const allVoiceSettings = document.querySelectorAll('ms-voice-settings');
        const targetSetting = allVoiceSettings[speakerIndex];

        if (targetSetting) {
          clearInterval(findSettingInterval);

          // 1. Kiểm tra nếu giọng hiện tại đã đúng rồi thì bỏ qua
          const currentVoiceEl = targetSetting.querySelector('.voice-display-name');
          if (currentVoiceEl && currentVoiceEl.textContent.trim().toLowerCase() === cleanVoiceName.toLowerCase()) {
            console.log(`✅ [SpeechPanel] Speaker [${speakerIndex}] đã chọn sẵn giọng "${cleanVoiceName}". Bỏ qua.`);
            return resolve(true);
          }

          // 2. Tìm trigger mở Dialog: .active-voice-card-trigger hoặc button[aria-label="Open voice settings"]
          const trigger = targetSetting.querySelector('.active-voice-card-trigger, button[aria-label="Open voice settings"]');
          if (!trigger) {
            console.warn(`⚠️ [SpeechPanel] Không tìm thấy trigger cho Speaker index ${speakerIndex}`);
            return resolve(false);
          }

          console.log(`🔘 [SpeechPanel] Click mở dialog chọn giọng cho Speaker [${speakerIndex}]...`);
          trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

          // 3. Đợi Dialog mat-dialog-container xuất hiện
          let dialogAttempts = 0;
          const checkDialogInterval = setInterval(async () => {
            dialogAttempts++;
            const dialog = document.querySelector('mat-dialog-container, ms-speaker-settings-panel');

            if (dialog) {
              clearInterval(checkDialogInterval);
              console.log("✅ [SpeechPanel] Dialog Speaker settings đã mở. Đang tìm giọng...");

              // Tìm thẻ voice-card có data-voice-name khớp
              let voiceCard = Array.from(dialog.querySelectorAll('.voice-card')).find(card => {
                const name = (card.getAttribute('data-voice-name') || '').trim().toLowerCase();
                const cardNameEl = card.querySelector('.voice-name');
                const textName = cardNameEl ? cardNameEl.textContent.trim().toLowerCase() : '';
                return name === cleanVoiceName.toLowerCase() || textName === cleanVoiceName.toLowerCase();
              });

              // Nếu chưa thấy trong danh sách mặc định, sử dụng ô Search voices
              if (!voiceCard) {
                const searchInput = dialog.querySelector('input[aria-label="Search voices"], .voice-search-input input');
                if (searchInput) {
                  console.log(`🔍 [SpeechPanel] Đang tìm kiếm giọng "${cleanVoiceName}" qua ô Search...`);
                  searchInput.focus();
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                  if (setter) {
                    setter.call(searchInput, cleanVoiceName);
                  } else {
                    searchInput.value = cleanVoiceName;
                  }
                  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                  searchInput.dispatchEvent(new Event('change', { bubbles: true }));

                  // Chờ 600ms cho kết quả tìm kiếm load
                  await new Promise(r => setTimeout(r, 600));

                  voiceCard = Array.from(dialog.querySelectorAll('.voice-card')).find(card => {
                    const name = (card.getAttribute('data-voice-name') || '').trim().toLowerCase();
                    const cardNameEl = card.querySelector('.voice-name');
                    const textName = cardNameEl ? cardNameEl.textContent.trim().toLowerCase() : '';
                    return name.includes(cleanVoiceName.toLowerCase()) || textName.includes(cleanVoiceName.toLowerCase());
                  });
                }
              }

              // Click vào voice card được tìm thấy
              if (voiceCard) {
                const clickTarget = voiceCard.querySelector('button.voice-card-content') || voiceCard;
                console.log(`✅ [SpeechPanel] Tìm thấy giọng "${cleanVoiceName}". Đang click chọn...`);
                clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await new Promise(r => setTimeout(r, 400));
              } else {
                console.warn(`⚠️ [SpeechPanel] Không tìm thấy thẻ giọng nói "${cleanVoiceName}" trong dialog.`);
              }

              // 4. BẮT BUỘC: Đóng Dialog để không che khuất màn hình và giải phóng cho speaker tiếp theo
              const closeBtn = dialog.querySelector('button[aria-label="Close panel"], button[data-test-close-button], button[mat-dialog-close], .panel-header button');
              if (closeBtn) {
                console.log("🔒 [SpeechPanel] Đóng dialog speaker settings...");
                closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              } else {
                const backdrop = document.querySelector('.cdk-overlay-backdrop');
                if (backdrop) backdrop.click();
              }

              // Chờ 400ms cho dialog đóng hoàn tất
              await new Promise(r => setTimeout(r, 400));
              resolve(true);

            } else if (dialogAttempts > 40) {
              clearInterval(checkDialogInterval);
              console.warn(`⚠️ [SpeechPanel] Timeout: Không tìm thấy dialog sau 4s.`);
              resolve(false);
            }
          }, 100);

        } else if (Date.now() - startTime >= timeoutMs) {
          clearInterval(findSettingInterval);
          console.warn(`⚠️ [SpeechPanel] Timeout: Không tìm thấy ms-voice-settings cho Speaker index ${speakerIndex} sau ${timeoutMs}ms.`);
          resolve(false);
        }
      }, 100);
    });
  }

  static setSpeakerName(index, valueToSet, timeoutMs = 3000) {
    if (!valueToSet) return Promise.resolve(false);
    return new Promise((resolve) => {
      const startTime = Date.now();
      const pollInterval = setInterval(() => {
        const allVoiceSettings = document.querySelectorAll('ms-voice-settings');
        if (index < allVoiceSettings.length) {
          const input = allVoiceSettings[index].querySelector('input[aria-label="Speaker name"], input.speaker-alias-input');
          if (input) {
            clearInterval(pollInterval);
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) {
              setter.call(input, valueToSet);
            } else {
              input.value = valueToSet;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            try {
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valueToSet }));
            } catch (_) {}
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            console.log(`✅ [SpeechPanel] Đã set Speaker name [${index}] = "${valueToSet}"`);
            return resolve(true);
          }
        }

        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(pollInterval);
          console.warn(`⚠️ [SpeechPanel] Timeout: Không tìm thấy input Speaker name cho index ${index}`);
          resolve(false);
        }
      }, 100);
    });
  }

  /**
   * Tự động điền dữ liệu vào textarea của Scene hoặc Sample Context với cơ chế Polling, 4 tầng selector & Angular Native Setter
   * @param {string} labelText - 'Scene' hoặc 'Sample Context'
   * @param {string} valueToSet - Nội dung cần điền
   * @param {number} timeoutMs - Thời gian timeout tối đa (mặc định 6000ms)
   */
  static setTextareaValueByLabel(labelText, valueToSet, timeoutMs = 6000) {
    if (valueToSet === undefined || valueToSet === null || valueToSet === '') {
      console.log(`ℹ️ [SpeechPanel] Giá trị cho "${labelText}" rỗng, bỏ qua.`);
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      console.log(`⏳ [SpeechPanel] Đang tìm ô "${labelText}" để điền: "${valueToSet.slice(0, 30)}..."`);

      const pollInterval = setInterval(() => {
        let targetTextarea = null;
        let parentMsAutosize = null;

        // Tầng 1: Tìm qua thẻ <textarea> có aria-label khớp (case-insensitive)
        const allTextareas = Array.from(document.querySelectorAll('textarea'));
        for (const ta of allTextareas) {
          const ariaLabel = (ta.getAttribute('aria-label') || '').trim().toLowerCase();
          if (ariaLabel === labelText.toLowerCase()) {
            targetTextarea = ta;
            parentMsAutosize = ta.closest('ms-autosize-textarea');
            break;
          }
        }

        // Tầng 2: Tìm qua component cha <ms-autosize-textarea> có arialabel hoặc aria-label
        if (!targetTextarea) {
          const allMs = Array.from(document.querySelectorAll('ms-autosize-textarea'));
          for (const ms of allMs) {
            const al = (ms.getAttribute('arialabel') || ms.getAttribute('aria-label') || '').trim().toLowerCase();
            if (al === labelText.toLowerCase()) {
              parentMsAutosize = ms;
              targetTextarea = ms.shadowRoot ? ms.shadowRoot.querySelector('textarea') : ms.querySelector('textarea');
              if (targetTextarea) break;
            }
          }
        }

        // Tầng 3: Tìm qua tiêu đề h4, h3 hoặc .section-title trong context-container-item
        if (!targetTextarea) {
          const allTitles = Array.from(document.querySelectorAll('h4, h3, .section-title'));
          for (const title of allTitles) {
            if (title.textContent.trim().toLowerCase() === labelText.toLowerCase()) {
              const item = title.closest('.context-container-item') || title.parentElement;
              if (item) {
                targetTextarea = item.querySelector('textarea');
                parentMsAutosize = item.querySelector('ms-autosize-textarea');
                if (targetTextarea) break;
              }
            }
          }
        }

        // Tầng 4: Tìm qua placeholder đặc trưng trên AI Studio
        if (!targetTextarea) {
          for (const ta of allTextareas) {
            const ph = (ta.getAttribute('placeholder') || '').toLowerCase();
            if (labelText.toLowerCase() === 'scene' && ph.includes('bustling street')) {
              targetTextarea = ta;
              parentMsAutosize = ta.closest('ms-autosize-textarea');
              break;
            } else if (labelText.toLowerCase().includes('sample') && ph.includes('previous speaker')) {
              targetTextarea = ta;
              parentMsAutosize = ta.closest('ms-autosize-textarea');
              break;
            }
          }
        }

        if (targetTextarea) {
          clearInterval(pollInterval);
          console.log(`🎯 [SpeechPanel] Đã tìm thấy textarea cho "${labelText}"! Tiến hành gán giá trị...`);

          try {
            // 1. Focus vào phần tử
            targetTextarea.focus();

            // 2. Gán giá trị thông qua Prototype Setter của HTMLTextAreaElement
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(targetTextarea, valueToSet);
            } else {
              targetTextarea.value = valueToSet;
            }

            // 3. Dispatch chuỗi sự kiện đầy đủ cho Angular
            targetTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            try {
              targetTextarea.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: valueToSet
              }));
            } catch (_) {}
            targetTextarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

            // 4. Đồng bộ thuộc tính data-value trên component cha <ms-autosize-textarea>
            if (parentMsAutosize) {
              parentMsAutosize.setAttribute('data-value', valueToSet);
              parentMsAutosize.dispatchEvent(new Event('input', { bubbles: true }));
              parentMsAutosize.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 5. Blur nhẹ để Angular trigger touch & form validation
            targetTextarea.blur();

            console.log(`✅ [SpeechPanel] Đã điền thành công "${labelText}" (${valueToSet.length} ký tự).`);
          } catch (err) {
            console.error(`❌ [SpeechPanel] Lỗi khi gán giá trị cho "${labelText}":`, err);
          }

          setTimeout(() => resolve(true), 250);
        } else if (Date.now() - startTime >= timeoutMs) {
          clearInterval(pollInterval);
          console.warn(`⚠️ [SpeechPanel] Timeout: Không tìm thấy textarea cho "${labelText}" sau ${timeoutMs}ms.`);
          resolve(false);
        }
      }, 100);
    });
  }

  // Giữ alias tương thích ngược nếu có chỗ khác gọi hàm cũ
  static setTextareaValueByAriaLabel(labelText, valueToSet) {
    return GoogleAIStudioSpeechPanel.setTextareaValueByLabel(labelText, valueToSet);
  }

  // =================================================================
  // AUTO PASTE CLIPBOARD LOGIC
  // =================================================================

  /**
   * Tự động click nút "Text" và dán nội dung clipboard vào textarea prompt.
   * Luồng: Click nút Text (data-value="TEXT") -> Đợi textarea xuất hiện -> Đọc clipboard -> Điền vào textarea.
   * @param {string|null} cachedText - Nội dung clipboard đã đọc trước (nếu có)
   */
  static async autoPasteClipboardToPrompt(cachedText = null) {
    try {
      // Bước 0: Đóng panel cài đặt (nếu đang mở) trước khi thao tác
      await GoogleAIStudioSpeechPanel.clickClosePanel();

      // Bước 1: Click nút "Text" để chuyển sang chế độ nhập text
      await GoogleAIStudioSpeechPanel.clickTextModeButton();

      // Bước 2: Đợi textarea xuất hiện và dán nội dung clipboard vào
      await GoogleAIStudioSpeechPanel.pasteClipboardToPromptTextarea(cachedText);

      // Bước 3: Click nút "Run" để bắt đầu generate speech
      await GoogleAIStudioSpeechPanel.clickRunButton();

      // Bước 4: Đợi quá trình generate voice hoàn tất
      await GoogleAIStudioSpeechPanel.waitForGenerationComplete();

      // Bước 5: Pause audio (nếu đang tự play) và click Download
      await GoogleAIStudioSpeechPanel.pauseAndDownloadAudio();

      console.log("✅ [SpeechPanel] Auto Paste Clipboard + Run + Download completed.");
    } catch (error) {
      console.error("❌ [SpeechPanel] Auto Paste Clipboard failed:", error);
    }
  }

  /**
   * Tìm và click nút "Run" (type="submit", class="ctrl-enter-submits") trên giao diện AI Studio.
   * Sử dụng polling để đợi nút xuất hiện và sẵn sàng trên DOM.
   */
  static clickRunButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // Tối đa 5 giây (50 x 100ms)

      const pollInterval = setInterval(() => {
        attempts++;

        // Tìm nút Run bằng nhiều selector
        const runBtn =
          document.querySelector('button[type="submit"].ctrl-enter-submits') ||
          document.querySelector('button.ms-button-primary[type="submit"]');

        if (runBtn && runBtn.getAttribute('aria-disabled') !== 'true') {
          clearInterval(pollInterval);
          console.log('✅ [SpeechPanel] Found "Run" button. Clicking...');
          runBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          setTimeout(() => resolve(), 500);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn('⚠️ [SpeechPanel] "Run" button not found or disabled after 5s.');
          resolve(); // Không chặn luồng
        }
      }, 100);
    });
  }

  // =================================================================
  // WAIT FOR GENERATION & AUTO DOWNLOAD LOGIC
  // =================================================================

  /**
   * Đợi quá trình generate speech hoàn tất trên Google AI Studio.
   * Phát hiện hoàn tất bằng 2 dấu hiệu:
   * 1. Nút Run chuyển từ type="button" (Stop) về type="submit" (Run).
   * 2. Audio src đổi từ URL tĩnh sang data:audio/wav;base64,...
   * Timeout tối đa: 5 phút (300 giây).
   */
  static waitForGenerationComplete() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 3000; // 5 phút (3000 x 100ms)
      const POLL_INTERVAL_MS = 100;

      console.log('⏳ [SpeechPanel] Waiting for voice generation to complete...');

      const pollInterval = setInterval(() => {
        attempts++;

        // Dấu hiệu 1: Nút Run trở về trạng thái submit (không còn "Stop")
        const runBtn = document.querySelector('ms-run-button button');
        const isStillProcessing = runBtn && runBtn.getAttribute('type') === 'button';

        // Dấu hiệu 2: Audio src đã đổi sang base64 (voice đã được generate)
        const audioEl = document.querySelector('ms-music-player audio');
        const hasGeneratedAudio = audioEl && audioEl.src && audioEl.src.startsWith('data:audio/');

        if (!isStillProcessing && hasGeneratedAudio) {
          clearInterval(pollInterval);
          console.log(`✅ [SpeechPanel] Voice generation completed after ${(attempts * POLL_INTERVAL_MS / 1000).toFixed(1)}s.`);
          // Đợi thêm 1 giây cho UI ổn định hoàn toàn
          setTimeout(() => resolve(), 1000);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn('⚠️ [SpeechPanel] Voice generation timeout after 5 minutes. Proceeding anyway...');
          resolve();
        }

        // Log tiến trình mỗi 10 giây
        if (attempts % 100 === 0) {
          console.log(`⏳ [SpeechPanel] Still waiting... (${(attempts * POLL_INTERVAL_MS / 1000).toFixed(0)}s elapsed)`);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  /**
   * Pause audio đang phát (nếu có) và click nút Download.
   * Sau khi generate xong, AI Studio tự động play audio.
   * Method này sẽ: Pause → Đợi một chút → Click Download.
   */
  static pauseAndDownloadAudio() {
    return new Promise((resolve) => {
      // Bước 1: Pause audio nếu đang play
      // Tìm nút pause bằng nhiều selector để tăng độ tin cậy
      const playPauseBtn =
        document.querySelector('button[aria-label="Pause"]') ||
        document.querySelector('.play-pause-button') ||
        document.querySelector('ms-music-player button.play-pause-button');

      console.log('🔍 [SpeechPanel] Play/Pause button found:', !!playPauseBtn);

      if (playPauseBtn) {
        const ariaLabel = playPauseBtn.getAttribute('aria-label');
        console.log(`🔍 [SpeechPanel] Button aria-label: "${ariaLabel}"`);

        if (ariaLabel === 'Pause') {
          // Đang play → click để pause
          console.log('⏸️ [SpeechPanel] Audio is playing. Clicking pause...');
          playPauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } else {
          console.log('ℹ️ [SpeechPanel] Audio is already paused or not playing.');
        }
      } else {
        console.warn('⚠️ [SpeechPanel] Play/Pause button not found.');
      }

      // Bước 2: Đợi UI cập nhật rồi click Download
      setTimeout(() => {
        const downloadBtn =
          document.querySelector('button[aria-label="Download"]') ||
          document.querySelector('.download-button') ||
          document.querySelector('ms-music-player .download-button');

        if (downloadBtn && downloadBtn.getAttribute('aria-disabled') !== 'true') {
          console.log('⬇️ [SpeechPanel] Clicking download button...');
          downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          console.log('✅ [SpeechPanel] Download triggered successfully.');
        } else {
          console.warn('⚠️ [SpeechPanel] Download button not found or disabled.');
        }
        resolve();
      }, 500);
    });
  }

  /**
   * Tìm và click nút đóng panel (aria-label="Close panel") trên giao diện AI Studio.
   * Dùng để đóng panel cài đặt trước khi chuyển sang chế độ nhập text.
   */
  static clickClosePanel() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30; // Tối đa 3 giây (30 x 100ms)

      const pollInterval = setInterval(() => {
        attempts++;

        // Tìm nút Close panel bằng nhiều selector để tăng độ tin cậy
        const closeBtn =
          document.querySelector('button[data-test-close-button]') ||
          document.querySelector('button[aria-label="Close panel"]') ||
          document.querySelector('button[mat-dialog-close]');

        if (closeBtn) {
          clearInterval(pollInterval);
          console.log('✅ [SpeechPanel] Found "Close panel" button. Clicking...');
          // Dispatch MouseEvent đầy đủ để Angular Material Dialog nhận diện
          closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          // Đợi UI cập nhật sau khi đóng panel
          setTimeout(() => resolve(), 800);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn('⚠️ [SpeechPanel] "Close panel" button not found. Proceeding anyway...');
          resolve(); // Không chặn luồng, panel có thể đã đóng sẵn
        }
      }, 100);
    });
  }

  /**
   * Tìm và click vào nút "Text" (role="radio", data-value="TEXT") trên giao diện AI Studio.
   * Sử dụng polling để đợi nút xuất hiện trên DOM.
   */
  static clickTextModeButton() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // Tối đa 5 giây (50 x 100ms)

      const pollInterval = setInterval(() => {
        attempts++;

        // Tìm nút Text bằng thuộc tính data-value="TEXT"
        const textButton = document.querySelector('button[data-value="TEXT"]');
        if (textButton) {
          clearInterval(pollInterval);
          console.log('✅ [SpeechPanel] Found "Text" button. Clicking...');
          textButton.click();
          // Đợi UI cập nhật sau khi click
          setTimeout(() => resolve(), 500);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn('⚠️ [SpeechPanel] "Text" button not found after 5s. Proceeding anyway...');
          resolve(); // Không reject để không chặn luồng, có thể textarea đã hiện sẵn
        }
      }, 100);
    });
  }

  /**
   * Tìm ô textarea kịch bản (Text prompt) trên AI Studio bằng cơ chế 5 tầng selector.
   * Dựa trên DOM thực tế của AI Studio:
   * <div class="text-mode-container"><div class="style-instructions-textarea transcript-text"><textarea aria-label="Enter a prompt">
   * @returns {HTMLTextAreaElement|null}
   */
  static getPromptTextarea() {
    // Tầng 1: Selector chính xác qua aria-label
    let ta = document.querySelector('textarea[aria-label="Enter a prompt"]');
    if (ta) return ta;

    // Tầng 2: Selector theo cấu trúc container của AI Studio (.text-mode-container / .transcript-text)
    ta = document.querySelector('.text-mode-container textarea')
      || document.querySelector('.transcript-text textarea')
      || document.querySelector('.style-instructions-textarea textarea');
    if (ta) return ta;

    // Tầng 3: Selector qua placeholder đặc trưng ("Speaker 1: [empathy]...")
    const allTextareas = Array.from(document.querySelectorAll('textarea'));
    ta = allTextareas.find(el => {
      const ph = el.getAttribute('placeholder') || '';
      return ph.includes('Speaker 1:') || ph.includes("Type '[' for tags");
    });
    if (ta) return ta;

    // Tầng 4: Selector qua tiêu đề h4 "Text"
    const allTitles = Array.from(document.querySelectorAll('h4.section-title, h4'));
    const textTitle = allTitles.find(t => t.textContent.trim() === 'Text');
    if (textTitle) {
      const container = textTitle.closest('.text-mode-container') || textTitle.parentElement;
      if (container) {
        ta = container.querySelector('textarea');
        if (ta) return ta;
      }
    }

    // Tầng 5: Fallback selector phụ
    return document.querySelector('.prompt-input textarea');
  }

  /**
   * Gán giá trị vào ô Textarea kịch bản với Angular Native Prototype Setter & đầy đủ Event
   * @param {HTMLTextAreaElement} textarea - Phần tử textarea
   * @param {string} text - Nội dung kịch bản
   */
  static setPromptTextareaValue(textarea, text) {
    if (!textarea) return false;
    try {
      textarea.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, text);
      } else {
        textarea.value = text;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      try {
        textarea.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      } catch (_) {}
      textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return true;
    } catch (err) {
      console.error("❌ [SpeechPanel] Lỗi gán giá trị prompt textarea:", err);
      return false;
    }
  }

  /**
   * Đọc nội dung clipboard và dán vào textarea kịch bản (Text prompt).
   * Sử dụng Clipboard API để đọc text từ clipboard (hoặc dùng cachedText nếu đã đọc trước).
   * @param {string|null} cachedText - Nội dung clipboard đã đọc trước
   */
  static pasteClipboardToPromptTextarea(cachedText = null) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // Tối đa 5 giây

      const pollInterval = setInterval(async () => {
        attempts++;

        // Tìm textarea prompt bằng 5 tầng selector chuyên sâu
        const textarea = GoogleAIStudioSpeechPanel.getPromptTextarea();
        if (textarea) {
          clearInterval(pollInterval);
          try {
            let promptText = cachedText;

            // Nếu chưa có cachedText, đọc trực tiếp từ Clipboard API
            if (!promptText) {
              // Kiểm tra document focus để tránh lỗi "Document is not focused"
              if (!document.hasFocus()) {
                console.warn('⚠️ [SpeechPanel] Document is not focused. Waiting for user to click the page...');
                if (typeof ContentHelper !== 'undefined') {
                  ContentHelper.showToast('Vui lòng click vào trang AI Studio để tiếp tục tự động dán Clipboard!', 'warning');
                }
                await new Promise(resolveFocus => {
                  const onFocus = () => {
                    window.removeEventListener('focus', onFocus);
                    resolveFocus();
                  };
                  window.addEventListener('focus', onFocus);
                });
              }

              // Đọc nội dung từ clipboard
              promptText = await navigator.clipboard.readText();
            }

            if (!promptText || promptText.trim() === '') {
              console.warn('⚠️ [SpeechPanel] Clipboard is empty. Skipping paste.');
              return resolve();
            }

            // Điền nội dung clipboard vào textarea bằng Native Prototype Setter cho Angular
            GoogleAIStudioSpeechPanel.setPromptTextareaValue(textarea, promptText);

            console.log(`✅ [SpeechPanel] Pasted ${promptText.length} characters to prompt textarea.`);
            resolve();
          } catch (clipError) {
            console.error('❌ [SpeechPanel] Cannot read clipboard:', clipError);
            reject(clipError);
          }
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.error('❌ [SpeechPanel] Prompt textarea not found after 5s.');
          reject(new Error('Prompt textarea not found'));
        }
      }, 100);
    });
  }

  static insertSpeechPageButton() {
    console.log("🛠️ [SpeechPanel] insertSpeechPageButton called.");
    if (document.getElementById('content-helper-aistudio-speech-settings')) {
      return;
    }
    console.log("🛠️ [SpeechPanel] Creating Speech Settings button...");
    const container = document.createElement("div");
    container.id = "content-helper-button-container";
    const btn = document.createElement("button");
    const micSvg = window.CHIcons ? window.CHIcons.mic({ size: 14 }) : '🎙️';
    btn.innerHTML = `${micSvg} <span>Cài đặt</span>`;
    btn.className = 'ts-btn font-bold text-xs shadow-md transition-all active:scale-95';
    btn.addEventListener('click', (e) => {
      if (container.dataset.isDragging !== 'true') {
        window.__helperInjected?._toggleAIStudioSpeechSettings();
      }
    });
    Object.assign(container.style, { position: 'fixed', bottom: '20px', left: '20px', zIndex: '2147483647' });
    Object.assign(btn.style, { borderRadius: '24px', backgroundColor: 'var(--ch-surface)', color: 'var(--ch-text-primary)', border: '1px solid var(--ch-border-strong)', boxShadow: 'var(--ch-shadow-panel)', whiteSpace: 'nowrap', overflow: 'hidden', transition: 'width 0.3s ease, padding 0.3s ease, background-color 0.15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'move' });
    const expandedText = `${micSvg} <span>Cài đặt</span>`, collapsedText = micSvg;
    const updateButtonState = (isHovering) => {
      if (container.dataset.isDragging === 'true') return;
      if (isHovering) {
        btn.innerHTML = expandedText; btn.style.width = '130px'; btn.style.padding = '12px 20px';
      } else {
        btn.innerHTML = collapsedText; btn.style.width = '48px'; btn.style.padding = '12px';
      }
    };
    btn.addEventListener('mouseenter', () => updateButtonState(true));
    btn.addEventListener('mouseleave', () => updateButtonState(false));
    let shiftX = 0, shiftY = 0;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      container.dataset.isDragging = 'false';
      const rect = container.getBoundingClientRect();
      shiftX = e.clientX - rect.left;
      shiftY = e.clientY - rect.top;
      const onMouseMove = (moveEvent) => {
        container.dataset.isDragging = 'true';
        container.style.left = `${moveEvent.clientX - shiftX}px`;
        container.style.top = `${moveEvent.clientY - shiftY}px`;
        container.style.bottom = 'auto';
        container.style.right = 'auto';
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        setTimeout(() => {
          container.dataset.isDragging = 'false';
          if (btn.matches(':hover')) { updateButtonState(true); }
        }, 50);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    container.appendChild(btn);
    document.body.appendChild(container);
    console.log("✅ [SpeechPanel] Button injected to body.");
    setTimeout(() => { btn.innerHTML = expandedText; updateButtonState(false); }, 100);
  }

  _syncToFirestore() {
    console.log("☁️ [SpeechPanel] Syncing profiles to Firestore...");
    chrome.storage.local.get(["google_user_email"], async (items) => {
      const userId = items.google_user_email;

      if (!userId) {
        console.warn("⚠️ User not logged in with Google, cannot sync to Firestore.");
        return;
      }

      const helper = new FirestoreHelper(firebaseConfig);
      helper.collection = 'speech_profiles';

      try {
        const dataToSync = {
          profiles: this.profiles,
          activeProfileName: this.activeProfileName,
        };
        await helper.saveUserConfig(userId, dataToSync);
        console.log("☁️ Profiles synced to Firestore successfully.");
      } catch (err) {
        console.error("❌ Firestore Sync Error:", err);
        ContentHelper.showToast("Lỗi khi đồng bộ profile lên Firestore.", "error");
      }
    });
  }

  destroy() {
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick);
      this._onDocClick = null;
    }
    super.destroy();
  }
}
