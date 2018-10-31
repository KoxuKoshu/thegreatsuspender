/*global chrome, historyItems, gsAnalytics, gsMessages, gsSession, gsStorage, gsIndexedDb, gsChrome, gsUtils */
(function(global) {
  'use strict';

  const backgroundPage = chrome.extension.getBackgroundPage();
  if (!backgroundPage || !backgroundPage.tgs) {
    setTimeout(() => location.replace(location.href), 1000);
    return;
  }
  backgroundPage.tgs.setViewGlobals(global, 'recovery');

  var restoreAttempted = false;
  var tabsToRecover = [];

  async function getRecoverableTabs(currentTabs) {
    const lastSession = await gsIndexedDb.fetchLastSession();
    //check to see if they still exist in current session
    if (lastSession) {
      gsUtils.removeInternalUrlsFromSession(lastSession);
      for (const window of lastSession.windows) {
        for (const tabProperties of window.tabs) {
          if (gsUtils.isSuspendedTab(tabProperties)) {
            var originalUrl = gsUtils.getSuspendedUrl(tabProperties.url);
            // Ignore suspended tabs from previous session that exist unsuspended now
            const originalTab = currentTabs.find(o => o.url === originalUrl);
            if (!originalTab) {
              tabProperties.windowId = window.id;
              tabProperties.sessionId = lastSession.sessionId;
              tabsToRecover.push(tabProperties);
            }
          }
        }
      }
      return tabsToRecover;
    }
  }

  function removeSuspendedTabFromList(tabToRemove) {
    var recoveryTabsEl = document.getElementById('recoveryTabs'),
      childLinks = recoveryTabsEl.children;

    for (var i = 0; i < childLinks.length; i++) {
      var element = childLinks[i];
      if (
        element.getAttribute('data-url') === tabToRemove.url ||
        element.getAttribute('data-tabId') == tabToRemove.id
      ) {
        // eslint-disable-line eqeqeq
        recoveryTabsEl.removeChild(element);
      }
    }

    //if removing the last element.. (re-get the element this function gets called asynchronously
    if (document.getElementById('recoveryTabs').children.length === 0) {
      //if we have already clicked the restore button then redirect to success page
      if (restoreAttempted) {
        document.getElementById('suspendy-guy-inprogress').style.display =
          'none';
        document.getElementById('recovery-inprogress').style.display = 'none';
        document.getElementById('suspendy-guy-complete').style.display =
          'inline-block';
        document.getElementById('recovery-complete').style.display =
          'inline-block';

        //otherwise we have no tabs to recover so just hide references to recovery
      } else {
        hideRecoverySection();
      }
    }
  }

  function showTabSpinners() {
    var recoveryTabsEl = document.getElementById('recoveryTabs'),
      childLinks = recoveryTabsEl.children;

    for (var i = 0; i < childLinks.length; i++) {
      var tabContainerEl = childLinks[i];
      tabContainerEl.removeChild(tabContainerEl.firstChild);
      var spinnerEl = document.createElement('span');
      spinnerEl.classList.add('faviconSpinner');
      tabContainerEl.insertBefore(spinnerEl, tabContainerEl.firstChild);
    }
  }

  function hideRecoverySection() {
    var recoverySectionEls = document.getElementsByClassName('recoverySection');
    for (var i = 0; i < recoverySectionEls.length; i++) {
      recoverySectionEls[i].style.display = 'none';
    }
    document.getElementById('restoreSession').style.display = 'none';
  }

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request && request.recoveredTab) {
      removeSuspendedTabFromList(request.recoveredTab);
    }
    sendResponse();
    return false;
  });

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(async function() {
    var restoreEl = document.getElementById('restoreSession'),
      manageEl = document.getElementById('manageManuallyLink'),
      previewsEl = document.getElementById('previewsOffBtn'),
      recoveryEl = document.getElementById('recoveryTabs'),
      warningEl = document.getElementById('screenCaptureNotice'),
      tabEl;

    manageEl.onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
    };

    if (previewsEl) {
      previewsEl.onclick = function(e) {
        gsStorage.setOption(gsStorage.SCREEN_CAPTURE, '0');
        window.location.reload();
      };

      //show warning if screen capturing turned on
      if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0') {
        warningEl.style.display = 'block';
      }
    }

    var performRestore = async function() {
      restoreAttempted = true;
      restoreEl.className += ' btnDisabled';
      restoreEl.removeEventListener('click', performRestore);
      showTabSpinners();
      while (gsSession.isInitialising()) {
        await gsUtils.setTimeout(200);
      }
      await gsSession.recoverLostTabs();
    };

    restoreEl.addEventListener('click', performRestore);

    const currentTabs = await gsChrome.tabsQuery();
    const tabsToRecover = await getRecoverableTabs(currentTabs);
    if (tabsToRecover.length === 0) {
      hideRecoverySection();
      return;
    }

    for (var tabToRecover of tabsToRecover) {
      tabToRecover.favIconUrl = gsUtils.getCleanTabFavicon(tabToRecover);
      tabToRecover.title = gsUtils.getCleanTabTitle(tabToRecover);
      tabEl = historyItems.createTabHtml(tabToRecover, false);
      tabEl.onclick = function() {
        return function(e) {
          e.preventDefault();
          chrome.tabs.create({ url: tabToRecover.url, active: false });
          removeSuspendedTabFromList(tabToRecover);
        };
      };
      recoveryEl.appendChild(tabEl);
    }

    var currentSuspendedTabs = currentTabs.filter(o =>
      gsUtils.isSuspendedTab(o, true)
    );
    for (const suspendedTab of currentSuspendedTabs) {
      gsMessages.sendPingToTab(suspendedTab.id, function(error) {
        if (error) {
          gsUtils.warning(suspendedTab.id, 'Failed to sendPingToTab', error);
        } else {
          removeSuspendedTabFromList(suspendedTab);
        }
      });
    }
  });

  gsAnalytics.reportPageView('recovery.html');
})(this);
