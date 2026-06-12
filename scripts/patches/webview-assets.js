"use strict";

const { recordStrategy } = require("./strategy-telemetry.js");

const fs = require("node:fs");
const path = require("node:path");

const {
  escapeRegExp,
  findMatchingBrace,
} = require("./shared.js");

// Webview asset patches target hashed browser chunks copied out of app.asar.
// They stay fail-soft because upstream chunk names and minified symbols drift.
const LINUX_SAFE_MONOSPACE_FONT_STACK =
  "\"Noto Sans Mono\", \"DejaVu Sans Mono\", \"Liberation Mono\", \"Ubuntu Mono\", ui-monospace, \"SFMono-Regular\", \"SF Mono\", Menlo, Consolas, monospace";
const LINUX_TOOLTIP_COLLISION_PADDING_TOP = 44;
const LINUX_WINDOW_CONTROLS_SAFE_AREA_RIGHT = 138;

function applyLinuxSafeMonospaceFontStackPatch(currentSource) {
  const safeLinuxMonoFontPattern =
    /`[^`]*(?:Noto Sans Mono|DejaVu Sans Mono|Liberation Mono|Ubuntu Mono)[^`]*monospace[^`]*`/u;
  if (safeLinuxMonoFontPattern.test(currentSource)) {
    return currentSource;
  }

  const unsafeDefaultStack = "`ui-monospace, \"SFMono-Regular\", Menlo, Consolas, monospace`";
  if (currentSource.includes(unsafeDefaultStack)) {
    return currentSource.replace(
      unsafeDefaultStack,
      `\`${LINUX_SAFE_MONOSPACE_FONT_STACK}\``,
    );
  }

  if (currentSource.includes("ui-monospace") && currentSource.includes("monospace")) {
    console.warn(
      "WARN: Could not find Linux monospace font stack insertion point — skipping default font stack patch",
    );
  }

  return currentSource;
}

function applyLinuxOpaqueWindowsDefaultPatch(currentSource) {
  let patchedSource = currentSource;
  let warnedMissingNeedle = false;
  const mergeDefaultPatched = () =>
    patchedSource.includes("opaqueWindows:e?.opaqueWindows??(typeof navigator<`u`&&");
  const settingsDefaultPatched = () =>
    patchedSource.includes("navigator.userAgent.includes(`Linux`)&&r?.opaqueWindows==null") ||
    patchedSource.includes("navigator.userAgent.includes(`Linux`)&&x?.opaqueWindows==null") ||
    /navigator\.userAgent\.includes\(`Linux`\)&&[A-Za-z_$][\w$]*\?\.opaqueWindows==null/u.test(patchedSource);
  const runtimeDefaultPatched = () =>
    patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&((o===`light`?l:f)?.opaqueWindows==null") ||
    patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&((s===`light`?u:p)?.opaqueWindows==null") ||
    patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&g.opaqueWindows==null&&(g={...g,opaqueWindows:!0})") ||
    /useState\)\(document\.documentElement\.dataset\.codexOs===`linux`\)/.test(patchedSource) ||
    /document\.documentElement\.dataset\.codexOs===`linux`&&\(\([A-Za-z_$][\w$]*===`light`\?[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*\)\?\.opaqueWindows==null/u.test(patchedSource);
  const linuxDefaultPatched = () =>
    mergeDefaultPatched() || settingsDefaultPatched() || runtimeDefaultPatched();
  const warnMissingNeedle = () => {
    if (warnedMissingNeedle || linuxDefaultPatched()) {
      return;
    }
    warnedMissingNeedle = true;
    console.warn(
      "WARN: Could not find Linux opaque window default insertion point — skipping settings default patch",
    );
  };

  const mergeNeedle = "opaqueWindows:e?.opaqueWindows??n.opaqueWindows,semanticColors:";
  const mergePatch =
    "opaqueWindows:e?.opaqueWindows??(typeof navigator<`u`&&((navigator.userAgentData?.platform??navigator.platform??navigator.userAgent).toLowerCase().includes(`linux`))?!0:n.opaqueWindows),semanticColors:";

  if (mergeDefaultPatched()) {
    // Already patched.
  } else if (patchedSource.includes(mergeNeedle)) {
    patchedSource = patchedSource.replace(mergeNeedle, mergePatch);
  } else if (patchedSource.includes("opaqueWindows") && patchedSource.includes("semanticColors")) {
    warnMissingNeedle();
  }

  const settingsNeedle =
    "let d=ot(r,e),f=at(e),p={codeThemeId:tt(a,e).id,theme:d},";
  const settingsPatch =
    "let d=ot(r,e);navigator.userAgent.includes(`Linux`)&&r?.opaqueWindows==null&&(d={...d,opaqueWindows:!0});let f=at(e),p={codeThemeId:tt(a,e).id,theme:d},";
  if (patchedSource.includes("navigator.userAgent.includes(`Linux`)&&r?.opaqueWindows==null")) {
    // Already patched.
  } else if (patchedSource.includes(settingsNeedle)) {
    patchedSource = patchedSource.replace(settingsNeedle, settingsPatch);
  }

  const currentSettingsNeedle = "setThemePatch:b,theme:x}=ne(t),S=$t(i,t),";
  const currentSettingsPatch =
    "setThemePatch:b,theme:x}=ne(t);navigator.userAgent.includes(`Linux`)&&x?.opaqueWindows==null&&(x={...x,opaqueWindows:!0});let S=$t(i,t),";
  if (patchedSource.includes("navigator.userAgent.includes(`Linux`)&&x?.opaqueWindows==null")) {
    // Already patched.
  } else if (patchedSource.includes(currentSettingsNeedle)) {
    patchedSource = patchedSource.replace(currentSettingsNeedle, currentSettingsPatch);
  }

  const currentSettingsRegex =
    /setThemePatch:([A-Za-z_$][\w$]*),theme:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\),([A-Za-z_$][\w$]*)=/;
  if (patchedSource.includes("navigator.userAgent.includes(`Linux`)&&x?.opaqueWindows==null")) {
    // Already patched by the current-settings branch above.
  } else if (/navigator\.userAgent\.includes\(`Linux`\)&&[A-Za-z_$][\w$]*\?\.opaqueWindows==null/.test(patchedSource)) {
    // Already patched with drifted minified names.
  } else if (currentSettingsRegex.test(patchedSource)) {
    patchedSource = patchedSource.replace(
      currentSettingsRegex,
      (match, setThemePatchVar, themeVar, hookVar, variantVar, nextVar) =>
        `setThemePatch:${setThemePatchVar},theme:${themeVar}}=${hookVar}(${variantVar});navigator.userAgent.includes(\`Linux\`)&&${themeVar}?.opaqueWindows==null&&(${themeVar}={...${themeVar},opaqueWindows:!0});let ${nextVar}=`,
    );
  }

  const runtimeNeedle =
    "let T=o===`light`?C:w,E;if(T.opaqueWindows&&!XZ()){";
  const runtimePatch =
    "let T=o===`light`?C:w,E;document.documentElement.dataset.codexOs===`linux`&&((o===`light`?l:f)?.opaqueWindows==null&&(T={...T,opaqueWindows:!0}));if(T.opaqueWindows&&!XZ()){";
  if (patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&((o===`light`?l:f)?.opaqueWindows==null")) {
    // Already patched.
  } else if (patchedSource.includes(runtimeNeedle)) {
    patchedSource = patchedSource.replace(runtimeNeedle, runtimePatch);
  }

  const currentRuntimeNeedle = "let T=s===`light`?S:w,E;";
  const currentRuntimePatch =
    "let T=s===`light`?S:w,E;document.documentElement.dataset.codexOs===`linux`&&((s===`light`?u:p)?.opaqueWindows==null&&(T={...T,opaqueWindows:!0}));";
  if (patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&((s===`light`?u:p)?.opaqueWindows==null")) {
    // Already patched.
  } else if (patchedSource.includes(currentRuntimeNeedle)) {
    patchedSource = patchedSource.replace(currentRuntimeNeedle, currentRuntimePatch);
  }

  const appMainRuntimeNeedle =
    "if((g.opaqueWindows||i)&&!pc()){e.classList.add(`electron-opaque`);return}";
  const appMainRuntimePatch =
    "if(document.documentElement.dataset.codexOs===`linux`&&g.opaqueWindows==null&&(g={...g,opaqueWindows:!0}),(g.opaqueWindows||i)&&!pc()){e.classList.add(`electron-opaque`);return}";
  if (patchedSource.includes("document.documentElement.dataset.codexOs===`linux`&&g.opaqueWindows==null&&(g={...g,opaqueWindows:!0})")) {
    // Already patched.
  } else if (patchedSource.includes(appMainRuntimeNeedle)) {
    patchedSource = patchedSource.replace(appMainRuntimeNeedle, appMainRuntimePatch);
  }

  const appMainStatePatched = () =>
    /useState\)\(document\.documentElement\.dataset\.codexOs===`linux`\)/.test(patchedSource);
  const appMainStateRegex =
    /\[([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\]=\(0,([A-Za-z_$][\w$]*)\.useState\)\(!1\),([A-Za-z_$][\w$]*)=/;
  if (!appMainStatePatched() && currentSource.includes("electron-window-opaque-surface-changed")) {
    const eventIndex = patchedSource.indexOf("electron-window-opaque-surface-changed");
    const prefixStart = Math.max(0, eventIndex - 2000);
    const prefix = patchedSource.slice(prefixStart, eventIndex);
    const stateMatches = [...prefix.matchAll(new RegExp(appMainStateRegex.source, "g"))];
    const stateMatch = stateMatches[stateMatches.length - 1];
    if (stateMatch?.index != null) {
      const [match, stateVar, setterVar, reactVar, nextVar] = stateMatch;
      const replacement =
        `[${stateVar},${setterVar}]=(0,${reactVar}.useState)(document.documentElement.dataset.codexOs===\`linux\`),${nextVar}=`;
      const matchStart = prefixStart + stateMatch.index;
      patchedSource =
        patchedSource.slice(0, matchStart) +
        replacement +
        patchedSource.slice(matchStart + match.length);
    }
  }

  if (!runtimeDefaultPatched()) {
    const currentRuntimeRegex =
      /let\{data:([A-Za-z_$][\w$]*)\}=Qc\([A-Za-z_$][\w$]*\.APPEARANCE_LIGHT_CHROME_THEME,[A-Za-z_$][\w$]*\).*?let\{data:([A-Za-z_$][\w$]*)\}=Qc\([A-Za-z_$][\w$]*\.APPEARANCE_DARK_CHROME_THEME,[A-Za-z_$][\w$]*\).*?let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)===`light`\?([A-Za-z_$][\w$]*):([A-Za-z_$][\w$]*),/;
    const currentRuntimeMatch = patchedSource.match(currentRuntimeRegex);
    if (currentRuntimeMatch != null) {
      const [
        ,
        lightThemeRawVar,
        darkThemeRawVar,
        selectedThemeVar,
        resolvedVariantVar,
        lightThemeVar,
        darkThemeVar,
      ] = currentRuntimeMatch;
      const selectorNeedle =
        `let ${selectedThemeVar}=${resolvedVariantVar}===\`light\`?${lightThemeVar}:${darkThemeVar},`;
      const selectorPatch =
        `let ${selectedThemeVar}=${resolvedVariantVar}===\`light\`?${lightThemeVar}:${darkThemeVar};document.documentElement.dataset.codexOs===\`linux\`&&((${resolvedVariantVar}===\`light\`?${lightThemeRawVar}:${darkThemeRawVar})?.opaqueWindows==null&&(${selectedThemeVar}={...${selectedThemeVar},opaqueWindows:!0}));let `;
      if (patchedSource.includes(selectorNeedle)) {
        patchedSource = patchedSource.replace(selectorNeedle, selectorPatch);
      }
    }
  }

  if (
    patchedSource === currentSource &&
    !linuxDefaultPatched() &&
    (currentSource.includes("opaqueWindows") ||
      currentSource.includes("electron-opaque") ||
      currentSource.includes("translucentSidebar"))
  ) {
    warnMissingNeedle();
  }

  return patchedSource;
}

function applyLinuxWindowControlsSafeAreaPatch(currentSource) {
  const currentInset = `applicationMenu:Object.freeze({left:0,right:${LINUX_WINDOW_CONTROLS_SAFE_AREA_RIGHT}})`;
  const defaultInset = "applicationMenu:Object.freeze({left:0,right:0})";
  if (currentSource.includes(defaultInset)) {
    return currentSource.split(defaultInset).join(currentInset);
  }

  if (currentSource.includes(currentInset)) {
    return currentSource;
  }

  if (currentSource.includes("applicationMenu:Object.freeze({left:0,right:")) {
    console.warn(
      "WARN: Could not find Linux window controls safe-area insertion point — skipping safe-area patch",
    );
  }

  return currentSource;
}

function applyLinuxTooltipWindowControlsCollisionPatch(currentSource) {
  const currentPadding = `padding:{top:${LINUX_TOOLTIP_COLLISION_PADDING_TOP},right:8,bottom:8,left:8}`;
  const defaultMiddleware = "middleware:[a({mainAxis:C,crossAxis:t}),c({padding:8}),l({padding:8}),u({padding:8,apply({availableWidth:e,availableHeight:t,elements:n,rects:r})";
  const patchedMiddleware =
    `middleware:[a({mainAxis:C,crossAxis:t}),c({${currentPadding}}),l({${currentPadding}}),u({${currentPadding},apply({availableWidth:e,availableHeight:t,elements:n,rects:r})`;

  let patchedSource = currentSource;
  if (patchedSource.includes(defaultMiddleware)) {
    patchedSource = patchedSource.split(defaultMiddleware).join(patchedMiddleware);
  }

  const middlewarePattern =
    /middleware:\[([A-Za-z_$][\w$]*)\(\{mainAxis:([^{}]*?),crossAxis:([^{}]*?)\}\),([A-Za-z_$][\w$]*)\(\{padding:8\}\),([A-Za-z_$][\w$]*)\(\{padding:8\}\),([A-Za-z_$][\w$]*)\(\{padding:8,apply\(\{availableWidth:([A-Za-z_$][\w$]*),availableHeight:([A-Za-z_$][\w$]*),elements:([A-Za-z_$][\w$]*),rects:([A-Za-z_$][\w$]*)\}\)/g;
  patchedSource = patchedSource.replace(
    middlewarePattern,
    (_match, offsetAlias, mainAxis, crossAxis, shiftAlias, flipAlias, sizeAlias, availableWidth, availableHeight, elements, rects) =>
      `middleware:[${offsetAlias}({mainAxis:${mainAxis},crossAxis:${crossAxis}}),${shiftAlias}({${currentPadding}}),${flipAlias}({${currentPadding}}),${sizeAlias}({${currentPadding},apply({availableWidth:${availableWidth},availableHeight:${availableHeight},elements:${elements},rects:${rects}})`,
  );

  if (patchedSource !== currentSource || patchedSource.includes(currentPadding)) {
    return patchedSource;
  }

  if (currentSource.includes("middleware:[") && currentSource.includes("availableWidth")) {
    console.warn(
      "WARN: Could not find tooltip collision padding insertion point — skipping Linux tooltip titlebar collision patch",
    );
  }

  return currentSource;
}

function findLocalEnvironmentActionModalFunction(currentSource) {
  const componentPattern =
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=\(0,([A-Za-z_$][\w$]*)\.c\)\(\d+\),\{action:([A-Za-z_$][\w$]*),[^{}]*onUpdate:([A-Za-z_$][\w$]*),workspaceRoot:([A-Za-z_$][\w$]*)\}=\2,/g;
  let match;
  while ((match = componentPattern.exec(currentSource)) != null) {
    const openBrace = currentSource.indexOf("{", match.index);
    const closeBrace = findMatchingBrace(currentSource, openBrace);
    if (closeBrace === -1) {
      continue;
    }
    const text = currentSource.slice(match.index, closeBrace + 1);
    if (
      text.includes("settings.localEnvironments.actions.add.description") &&
      text.includes("threadPage.runAction.setup.commandLabel") &&
      text.includes(`local-env-action-name-\${${match[5]}.id}`)
    ) {
      return {
        start: match.index,
        end: closeBrace + 1,
        text,
        paramVar: match[2],
        cacheVar: match[3],
        actionVar: match[5],
        updateVar: match[6],
        workspaceVar: match[7],
      };
    }
  }
  return null;
}

function applyLinuxThreadSidePanelNativeTooltipPatch(currentSource) {
  const nativeTitleNeedle = 'disabled:l,title:i,onClick:a,uniform:!0';
  const nativeTitlePatch = 'disabled:l,onClick:a,uniform:!0';

  if (!currentSource.includes("id:`thread.sidePanel.toggle`")) {
    return currentSource;
  }

  if (currentSource.includes(nativeTitlePatch) && !currentSource.includes(nativeTitleNeedle)) {
    return currentSource;
  }

  if (currentSource.includes(nativeTitleNeedle)) {
    return currentSource.split(nativeTitleNeedle).join(nativeTitlePatch);
  }

  if (currentSource.includes("tooltipContent:i") && currentSource.includes("title:i")) {
    console.warn(
      "WARN: Could not find thread side panel native tooltip insertion point — skipping Linux duplicate side panel tooltip patch",
    );
  }

  return currentSource;
}

function applyLinuxAppSunsetPatch(currentSource) {
  const statsigKey = "2929582856";
  const disabledGatePattern = /if\(!1&&([A-Za-z_$][\w$]*)\(`2929582856`\)\)\{/u;
  const gatePattern = /if\(([A-Za-z_$][\w$]*)\(`2929582856`\)\)\{/u;

  if (disabledGatePattern.test(currentSource)) {
    return currentSource;
  }

  if (gatePattern.test(currentSource)) {
    return currentSource.replace(gatePattern, "if(!1&&$1(`2929582856`)){");
  }

  if (currentSource.includes(statsigKey)) {
    console.warn("WARN: Could not find app sunset gate needle — skipping Linux app sunset patch");
  }

  return currentSource;
}

function applyLinuxBrowserUseAvailabilityPatch(currentSource) {
  const browserUseFeatureNeedle = "featureName:`browser_use`";
  const statsigNeedle = "410262010";
  let changed = false;

  const alreadyPatched = () =>
    /featureName:`browser_use`[\s\S]{0,1400}?isBrowserAgentGateEnabled:!0,/.test(currentSource);

  const gatePattern =
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\{isBrowserAgentGateEnabled:([A-Za-z_$][\w$]*),isBrowserSidebarEnabled:([A-Za-z_$][\w$]*),isBrowserUseEnabled:([A-Za-z_$][\w$]*),isLoading:([A-Za-z_$][\w$]*),runCodexInWsl:([A-Za-z_$][\w$]*),windowType:`electron`\}\)/g;

  const patchedSource = currentSource.replace(
    gatePattern,
    (
      match,
      resultVar,
      helperVar,
      gateVar,
      sidebarVar,
      browserUseVar,
      loadingVar,
      wslVar,
      offset,
    ) => {
      const contextStart = Math.max(0, offset - 1400);
      const context = currentSource.slice(contextStart, offset + match.length);
      if (!context.includes(browserUseFeatureNeedle) || !context.includes(statsigNeedle)) {
        return match;
      }

      changed = true;
      return `${resultVar}=${helperVar}({isBrowserAgentGateEnabled:!0,isBrowserSidebarEnabled:${sidebarVar},isBrowserUseEnabled:${browserUseVar},isLoading:${loadingVar},runCodexInWsl:${wslVar},windowType:\`electron\`})`;
    },
  );

  if (changed || alreadyPatched()) {
    return patchedSource;
  }

  if (currentSource.includes(browserUseFeatureNeedle) && currentSource.includes(statsigNeedle)) {
    console.warn(
      "WARN: Could not find Browser Use availability gate — skipping Linux Browser Use availability patch",
    );
  }

  return currentSource;
}

function applyLinuxBrowserUseNonLocalNavigationPatch(currentSource) {
  const messageNeedle = "browser-use-non-local-sites-allowed-changed";
  const statsigNeedle = "3903563814";
  let changed = false;

  const dispatchPattern =
    /((?:[A-Za-z_$][\w$]*=)?[A-Za-z_$][\w$]*\(`3903563814`\)[\s\S]{0,1800}?dispatchMessage\(`browser-use-non-local-sites-allowed-changed`,\{allowed:)([A-Za-z_$][\w$]*)(\}\))/g;

  const patchedSource = currentSource.replace(
    dispatchPattern,
    (match, prefix, allowedVar, suffix) => {
      changed = true;
      return `${prefix}!0${suffix}`;
    },
  );

  if (changed) {
    return patchedSource;
  }

  if (currentSource.includes(`${messageNeedle}\`,{allowed:!0}`)) {
    return currentSource;
  }

  if (currentSource.includes(messageNeedle) && currentSource.includes(statsigNeedle)) {
    console.warn(
      "WARN: Could not find Browser Use non-local navigation gate — skipping Linux Browser Use navigation patch",
    );
  }

  return currentSource;
}

function applyLinuxBrowserUseExternalAvailabilityPatch(currentSource) {
  const externalFeatureNeedle = "featureName:`browser_use_external`";
  const statsigNeedle = "410065390";
  let changed = false;

  const alreadyPatched = () =>
    /featureName:`browser_use_external`[\s\S]{0,900}?navigator\.userAgent\.includes\(`Linux`\)/.test(currentSource);

  const availabilityPattern =
    /let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)===`chrome-extension`\|\|([A-Za-z_$][\w$]*)&&\1\.enabled&&!\1\.isLoading,([A-Za-z_$][\w$]*)=\5===`chrome-extension`\?!1:\1\.isLoading,/g;

  const patchedSource = currentSource.replace(
    availabilityPattern,
    (
      match,
      featureQueryVar,
      featureQueryFn,
      featureQueryArg,
      availableVar,
      windowTypeVar,
      statsigVar,
      loadingVar,
      offset,
    ) => {
      const contextStart = Math.max(0, offset - 700);
      const context = currentSource.slice(contextStart, offset + match.length);
      if (!context.includes(externalFeatureNeedle) || !context.includes(statsigNeedle)) {
        return match;
      }

      changed = true;
      return `let ${featureQueryVar}=${featureQueryFn}(${featureQueryArg}),${availableVar}=${windowTypeVar}===\`chrome-extension\`||navigator.userAgent.includes(\`Linux\`)||${statsigVar}&&${featureQueryVar}.enabled&&!${featureQueryVar}.isLoading,${loadingVar}=${windowTypeVar}===\`chrome-extension\`||navigator.userAgent.includes(\`Linux\`)?!1:${featureQueryVar}.isLoading,`;
    },
  );

  if (changed || alreadyPatched()) {
    return patchedSource;
  }

  if (currentSource.includes(externalFeatureNeedle) && currentSource.includes(statsigNeedle)) {
    console.warn(
      "WARN: Could not find Browser Use external availability gate — skipping Linux external Browser Use availability patch",
    );
  }

  return currentSource;
}

function applyLinuxAppServerFeatureEnablementPatch(currentSource) {
  const supportedFeatures = new Set([
    "apps",
    "memories",
    "mentions_v2",
    "plugins",
    "remote_control",
    "remote_plugin",
    "tool_call_mcp_elicitation",
    "tool_suggest",
  ]);
  const defaultFeaturesMarker = "statsig_default_enable_features";
  const syncMethodMarker = "set-experimental-feature-enablement-for-host";
  if (
    !currentSource.includes(defaultFeaturesMarker) ||
    !currentSource.includes(syncMethodMarker)
  ) {
    return currentSource;
  }

  const featureArrayRegex =
    /var ([A-Za-z_$][\w$]*)=\[([^\]]*?)\];function ([A-Za-z_$][\w$]*)\(\)\{let [\s\S]{0,2400}?statsig_default_enable_features[\s\S]{0,2400}?set-experimental-feature-enablement-for-host/u;
  const featureArrayMatch = currentSource.match(featureArrayRegex);

  if (featureArrayMatch == null) {
    // 26.527.x replaced the static default-enable array with a dynamic builder
    // that copies supported defaults, then adds a gated extra. The copied
    // defaults are Linux-safe; the trailing extra is not.
    const dynamicBuilderExtraRegex =
      /(for\(let ([A-Za-z_$][\w$]*) of [A-Za-z_$][\w$]*\)\{let ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\[\2\];\3!=null&&\(([A-Za-z_$][\w$]*)\[\2\]=\3\)\})return \4\[([A-Za-z_$][\w$]*)\]=([A-Za-z_$][\w$]*),\4\}/u;
    const dynamicBuilderExtraMatch = currentSource.match(dynamicBuilderExtraRegex);
    if (dynamicBuilderExtraMatch != null) {
      const [, loopBlock, , , enablementVar, featureKeyVar] = dynamicBuilderExtraMatch;
      const featureKeyDeclaration = new RegExp(
        `${escapeRegExp(featureKeyVar)}=\`remote_plugin\``,
        "u",
      );
      if (featureKeyDeclaration.test(currentSource)) {
        return currentSource;
      }
      return currentSource.replace(
        dynamicBuilderExtraRegex,
        `${loopBlock}return ${enablementVar}}`,
      );
    }

    const dynamicBuilderSanitizedRegex =
      /for\(let ([A-Za-z_$][\w$]*) of [A-Za-z_$][\w$]*\)\{let ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\[\1\];\2!=null&&\(([A-Za-z_$][\w$]*)\[\1\]=\2\)\}return \3\}/u;
    if (dynamicBuilderSanitizedRegex.test(currentSource)) {
      return currentSource;
    }

    console.warn(
      "WARN: Could not find app-server feature enablement list — skipping unsupported feature compatibility patch",
    );
    return currentSource;
  }

  const [, arrayVar, featureArrayItems] = featureArrayMatch;
  const supportedFeatureArrayItems = featureArrayItems
    .split(",")
    .filter((entry) => {
      const featureMatch = entry.trim().match(/^`([^`]+)`$/u);
      return featureMatch != null && supportedFeatures.has(featureMatch[1]);
    })
    .join(",");
  if (supportedFeatureArrayItems === featureArrayItems) {
    return currentSource;
  }

  const featureArrayNeedle = `var ${arrayVar}=[${featureArrayItems}];`;
  const featureArrayPatch = `var ${arrayVar}=[${supportedFeatureArrayItems}];`;
  const featureArrayIndex = featureArrayMatch.index;
  if (
    featureArrayIndex == null ||
    currentSource.slice(featureArrayIndex, featureArrayIndex + featureArrayNeedle.length) !==
      featureArrayNeedle
  ) {
    console.warn(
      "WARN: Could not locate matched app-server feature enablement list — skipping unsupported feature compatibility patch",
    );
    return currentSource;
  }

  return [
    currentSource.slice(0, featureArrayIndex),
    featureArrayPatch,
    currentSource.slice(featureArrayIndex + featureArrayNeedle.length),
  ].join("");
}

function applyLinuxI18nGatePatch(currentSource) {
  const alreadyPatchedI18nGateRegexes = [
    /([A-Za-z_$][\w$]*)=[^;]*?\.get\(`enable_i18n`,!1\)[^;]*;let [^;]*,([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.localeOverride\),[A-Za-z_$][\w$]*=\1\|\|\2!=null/u,
    /([A-Za-z_$][\w$]*)=[^;]*?\.get\(`enable_i18n`,!0\)[^;]*,([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.localeOverride\);\1=\1\|\|\2!=null;/u,
  ];
  let patchedSource = currentSource.replace(
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*\?\.get\(`enable_i18n`,!1\)(?:,[^;]+?)?);let ([A-Za-z_$][\w$]*)=\1,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*\?\.get\(`locale_source`,`IDE`\)),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.localeOverride\)/g,
    (
      _match,
      gateVar,
      gateExpression,
      enabledVar,
      localeSourceVar,
      localeSourceExpression,
      localeOverrideVar,
      readLocaleOverrideVar,
      settingsVar,
    ) =>
      `${gateVar}=${gateExpression};let ${localeSourceVar}=${localeSourceExpression},${localeOverrideVar}=${readLocaleOverrideVar}(${settingsVar}.localeOverride),${enabledVar}=${gateVar}||${localeOverrideVar}!=null`,
  );

  patchedSource = patchedSource.replace(
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*\([^)]*\)\?\.get\(`enable_i18n`,!0\))((?:,\[[^\]]+\]=[^;]+?)),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.localeOverride\),([A-Za-z_$][\w$]*);/g,
    (
      _match,
      gateVar,
      gateExpression,
      betweenGateAndOverride,
      localeOverrideVar,
      readLocaleOverrideVar,
      settingsVar,
      nextVar,
    ) =>
      `${gateVar}=${gateExpression}${betweenGateAndOverride},${localeOverrideVar}=${readLocaleOverrideVar}(${settingsVar}.localeOverride);${gateVar}=${gateVar}||${localeOverrideVar}!=null;let ${nextVar};`,
  );

  patchedSource = patchedSource.replace(
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*\([^)]*\)\?\.get\(`enable_i18n`,!0\)),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.localeOverride\);/g,
    (
      match,
      gateVar,
      gateExpression,
      localeOverrideVar,
      readLocaleOverrideVar,
      settingsVar,
      offset,
      source,
    ) => {
      const appliedMarker = `${gateVar}=${gateVar}||${localeOverrideVar}!=null;`;
      if (source.startsWith(appliedMarker, offset + match.length)) {
        return match;
      }
      return `${gateVar}=${gateExpression},${localeOverrideVar}=${readLocaleOverrideVar}(${settingsVar}.localeOverride);${appliedMarker}`;
    },
  );

  if (
    currentSource.includes("enable_i18n") &&
    patchedSource === currentSource &&
    !alreadyPatchedI18nGateRegexes.some((regex) => regex.test(currentSource))
  ) {
    console.warn("WARN: Could not find i18n gate needle — skipping Linux i18n gate patch");
  }

  return patchedSource;
}

function applyLinuxProfileSettingsMenuPatch(currentSource) {
  if (!currentSource.includes("codex.profileDropdown.settingsPage")) {
    return currentSource;
  }

  const patchedSource = currentSource.replace(
    /([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(`4166894088`\)/g,
    "$1=!0",
  );

  if (currentSource.includes("4166894088") && patchedSource === currentSource) {
    console.warn("WARN: Could not find profile settings menu gate needle — skipping Linux settings menu patch");
  }

  return patchedSource;
}

function applyLinuxConfigWriteVersionConflictPatch(currentSource) {
  if (!currentSource.includes("expectedVersion:")) {
    return currentSource;
  }

  const patchedSource = currentSource.replace(
    /expectedVersion:(?:[A-Za-z_$][\w$]*\?\.[^,{}]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?:\?\?null)?/g,
    "expectedVersion:null",
  );

  if (patchedSource !== currentSource) {
    return patchedSource;
  }

  if (
    currentSource.includes("expectedVersion:") &&
    !currentSource.includes("expectedVersion:null")
  ) {
    console.warn(
      "WARN: Could not find config write expectedVersion needle — skipping config version-conflict patch",
    );
  }

  return currentSource;
}

function applySubagentNicknameMetadataPatch(currentSource) {
  let patchedSource = currentSource;
  const sourceShapePatchedRegex =
    /`subAgent`in ([A-Za-z_$][\w$]*)\?\1\.subAgent:`subagent`in \1\?\1\.subagent:null/u;
  const nicknamePatchedRegex =
    /([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.agentNickname\)\?\?\1\(\2\.agent_nickname\)\?\?\1\([A-Za-z_$][\w$]*\(\2\.source\)\?\.agentNickname\)/u;

  const sourceShapeNeedle =
    "function Mi(e){return`subAgent`in e?e.subAgent:null}function Ni(e){return typeof e==`string`?Pi():`thread_spawn`in e?{parentThreadId:j(e.thread_spawn.parent_thread_id),depth:e.thread_spawn.depth,agentNickname:e.thread_spawn.agent_nickname,agentRole:e.thread_spawn.agent_role}:Pi()}";
  const sourceShapePatch =
    "function Mi(e){return`subAgent`in e?e.subAgent:`subagent`in e?e.subagent:null}function Ni(e){return typeof e==`string`?Pi():`thread_spawn`in e?{parentThreadId:j(e.thread_spawn.parent_thread_id),depth:e.thread_spawn.depth,agentNickname:e.thread_spawn.agent_nickname,agentRole:e.thread_spawn.agent_role}:Pi()}";
  if (sourceShapePatchedRegex.test(patchedSource)) {
    // Already patched.
  } else if (patchedSource.includes(sourceShapeNeedle)) {
    patchedSource = patchedSource.replace(sourceShapeNeedle, sourceShapePatch);
  } else {
    const sourceShapeRegex =
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{return`subAgent`in \2\?\2\.subAgent:null\}function ([A-Za-z_$][\w$]*)\(/u;
    if (sourceShapeRegex.test(patchedSource)) {
      patchedSource = patchedSource.replace(
        sourceShapeRegex,
        "function $1($2){return`subAgent`in $2?$2.subAgent:`subagent`in $2?$2.subagent:null}function $3(",
      );
    }
  }

  const nicknameNeedle =
    "function Xl(e){return e==null?null:Zl(e.agentNickname)??Zl(B(e.source)?.agentNickname)}";
  const nicknamePatch =
    "function Xl(e){return e==null?null:Zl(e.agentNickname)??Zl(e.agent_nickname)??Zl(B(e.source)?.agentNickname)}";
  if (nicknamePatchedRegex.test(patchedSource)) {
    // Already patched.
  } else if (patchedSource.includes(nicknameNeedle)) {
    patchedSource = patchedSource.replace(nicknameNeedle, nicknamePatch);
  } else {
    const nicknameRegex =
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{return \2==null\?null:([A-Za-z_$][\w$]*)\(\2\.agentNickname\)\?\?\3\(([A-Za-z_$][\w$]*)\(\2\.source\)\?\.agentNickname\)\}/u;
    if (nicknameRegex.test(patchedSource)) {
      patchedSource = patchedSource.replace(
        nicknameRegex,
        "function $1($2){return $2==null?null:$3($2.agentNickname)??$3($2.agent_nickname)??$3($4($2.source)?.agentNickname)}",
      );
    }
  }

  if (
    patchedSource === currentSource &&
    !(sourceShapePatchedRegex.test(currentSource) && nicknamePatchedRegex.test(currentSource)) &&
    (currentSource.includes("agentNickname") ||
      currentSource.includes("agent_nickname") ||
      currentSource.includes("thread_spawn"))
  ) {
    console.warn("WARN: Could not find subagent nickname metadata needles — skipping metadata shape patch");
  }

  return patchedSource;
}

function applyLocalEnvironmentActionModalDraftPatch(currentSource) {
  if (currentSource.includes("codexLinuxActionDraft")) {
    return currentSource;
  }

  if (
    !currentSource.includes("settings.localEnvironments.actions.add.description") ||
    !currentSource.includes("threadPage.runAction.setup.commandLabel") ||
    !currentSource.includes("onUpdate:")
  ) {
    return currentSource;
  }

  const modalFunction = findLocalEnvironmentActionModalFunction(currentSource);
  if (modalFunction == null) {
    console.warn(
      "WARN: Could not find local environment action modal component — skipping action input patch",
    );
    return currentSource;
  }

  const beforeFunction = currentSource.slice(0, modalFunction.start);
  const afterFunction = currentSource.slice(modalFunction.end);
  let patchedFunction = modalFunction.text;
  const reactVar =
    currentSource.match(/\(0,([A-Za-z_$][\w$]*)\.useState\)\(/)?.[1] ?? "Q";
  const { actionVar, cacheVar, paramVar, updateVar, workspaceVar } = modalFunction;
  const stateNeedle = `workspaceRoot:${workspaceVar}}=${paramVar},`;
  const statePatch =
    `workspaceRoot:${workspaceVar}}=${paramVar},[codexLinuxActionDraft,codexLinuxSetActionDraft]=(0,${reactVar}.useState)(()=>${actionVar}),codexLinuxUpdateActionDraft=codexLinuxPatch=>(codexLinuxSetActionDraft(codexLinuxDraft=>({...codexLinuxDraft,...codexLinuxPatch})),${updateVar}(codexLinuxPatch)),`;
  const requiredReplacements = [
    {
      needle: stateNeedle,
      replacement: statePatch,
      description: "draft state insertion point",
    },
    {
      needle: `if(${cacheVar}[0]!==${actionVar}||`,
      replacement: `if(${cacheVar}[0]!==codexLinuxActionDraft||${cacheVar}[0]!==${actionVar}||`,
      description: "modal memo guard",
    },
    {
      needle: `${actionVar}.icon`,
      replacement: "codexLinuxActionDraft.icon",
      description: "icon draft references",
    },
    {
      needle: `${actionVar}.name`,
      replacement: "codexLinuxActionDraft.name",
      description: "name draft references",
    },
    {
      needle: `${actionVar}.command`,
      replacement: "codexLinuxActionDraft.command",
      description: "command draft references",
    },
    {
      needle: `${updateVar}({icon:e.value})`,
      replacement: "codexLinuxUpdateActionDraft({icon:e.value})",
      description: "icon update callback",
    },
    {
      needle: `${updateVar}({name:e.target.value})`,
      replacement: "codexLinuxUpdateActionDraft({name:e.target.value})",
      description: "name update callback",
    },
    {
      needle: `${updateVar}({command:e})`,
      replacement: "codexLinuxUpdateActionDraft({command:e})",
      description: "command update callback",
    },
  ];

  const savedPayloadPattern = new RegExp(
    String.raw`\{\.\.\.${actionVar},command:([A-Za-z_$][\w$]*),name:([A-Za-z_$][\w$]*)\}`,
  );
  if (!savedPayloadPattern.test(patchedFunction)) {
    console.warn(
      "WARN: Could not find local environment action modal saved action payload — skipping action input patch",
    );
    return currentSource;
  }
  patchedFunction = patchedFunction.replace(
    savedPayloadPattern,
    "{...codexLinuxActionDraft,command:$1,name:$2}",
  );

  const missingReplacement = requiredReplacements.find(
    ({ needle }) => !patchedFunction.includes(needle),
  );
  if (missingReplacement != null) {
    console.warn(
      `WARN: Could not find local environment action modal ${missingReplacement.description} — skipping action input patch`,
    );
    return currentSource;
  }

  for (const { needle, replacement } of requiredReplacements) {
    patchedFunction = patchedFunction.replaceAll(needle, replacement);
  }

  return `${beforeFunction}${patchedFunction}${afterFunction}`;
}

function applyBrowserAnnotationScreenshotPatch(currentSource) {
  let patchedSource = currentSource;

  const liveElementScreenshotNeedle =
    "if(M&&j?.anchor.kind===`element`){let e=qu(j,y.current)??null,t=e==null?null:rd(e);he=t?.rect??md(j.anchor),_e=t?.borderRadius}";
  const storedAnchorScreenshotPatch =
    "if(M&&j?.anchor.kind===`element`){he=md(j.anchor),_e=void 0}";
  if (patchedSource.includes(storedAnchorScreenshotPatch)) {
    // Already patched.
  } else if (
    /if\([A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\?\.anchor\.kind===`element`\)\{[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.anchor\),[A-Za-z_$][\w$]*=void 0\}/.test(patchedSource) ||
    /if\([A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\?\.annotation\.anchor\.kind===`element`\)\{[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.annotation\.anchor\),[A-Za-z_$][\w$]*=void 0,/.test(patchedSource)
  ) {
    // Already patched with the current upstream symbol names.
  } else if (patchedSource.includes(liveElementScreenshotNeedle)) {
    patchedSource = patchedSource.replace(liveElementScreenshotNeedle, storedAnchorScreenshotPatch);
  } else {
    const currentSelectedElementNeedle =
      "if(ve&&M?.anchor.kind===`element`){let e=hl(M,y.current)??null,t=e==null?null:El(e);ke=t?.rect??Rl(M.anchor),je=t?.borderRadius,Ae=Xl(M.anchor,ke,_.width,_.height)}";
    const currentSelectedElementPatch =
      "if(ve&&M?.anchor.kind===`element`){ke=Rl(M.anchor),je=void 0,Ae=Xl(M.anchor,ke,_.width,_.height)}";
    const currentCommentPreloadElementNeedle =
      "if(M&&j?.annotation.anchor.kind===`element`){let e=tt==null?null:ed(tt);at=e?.rect??Td(j.annotation.anchor),st=e?.borderRadius,ot=Wd(j.annotation.anchor,at,S.width,S.height)}";
    const currentCommentPreloadElementPatch =
      "if(M&&j?.annotation.anchor.kind===`element`){at=Td(j.annotation.anchor),st=void 0,ot=Wd(j.annotation.anchor,at,S.width,S.height)}";
    const currentElementScreenshotRegex =
      /if\(([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\?\.anchor\.kind===`element`\)\{let e=[^;{}]+?\?\?null,t=e==null\?null:[A-Za-z_$][\w$]*\(e\);([A-Za-z_$][\w$]*)=t\?\.rect\?\?([A-Za-z_$][\w$]*)\(\2\.anchor\),([A-Za-z_$][\w$]*)=t\?\.borderRadius\}/;
    const currentCommentPreloadElementRegex =
      /if\(([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\?\.annotation\.anchor\.kind===`element`\)\{let e=([A-Za-z_$][\w$]*)==null\?null:[A-Za-z_$][\w$]*\(\3\);([A-Za-z_$][\w$]*)=e\?\.rect\?\?([A-Za-z_$][\w$]*)\(\2\.annotation\.anchor\),([A-Za-z_$][\w$]*)=e\?\.borderRadius,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.annotation\.anchor,\4,([A-Za-z_$][\w$]*)\.width,([A-Za-z_$][\w$]*)\.height\)\}/;
    if (patchedSource.includes(currentSelectedElementNeedle)) {
      patchedSource = patchedSource.replace(currentSelectedElementNeedle, currentSelectedElementPatch);
    } else if (patchedSource.includes(currentCommentPreloadElementNeedle)) {
      patchedSource = patchedSource.replace(
        currentCommentPreloadElementNeedle,
        currentCommentPreloadElementPatch,
      );
    } else if (currentElementScreenshotRegex.test(patchedSource)) {
      const currentElementScreenshotMatch = patchedSource.match(currentElementScreenshotRegex);
      const [, screenshotModeVar, selectedCommentVar, rectVar, anchorRectFn, radiusVar] = currentElementScreenshotMatch;
      patchedSource = patchedSource.replace(
        currentElementScreenshotRegex,
        `if(${screenshotModeVar}&&${selectedCommentVar}?.anchor.kind===\`element\`){${rectVar}=${anchorRectFn}(${selectedCommentVar}.anchor),${radiusVar}=void 0}`,
      );
    } else if (currentCommentPreloadElementRegex.test(patchedSource)) {
      patchedSource = patchedSource.replace(
        currentCommentPreloadElementRegex,
        (
          _match,
          screenshotModeVar,
          selectedAnnotationVar,
          _connectedElementVar,
          rectVar,
          anchorRectFn,
          radiusVar,
          highlightClassVar,
          highlightFn,
          widthSourceVar,
          heightSourceVar,
        ) =>
          `if(${screenshotModeVar}&&${selectedAnnotationVar}?.annotation.anchor.kind===\`element\`){${rectVar}=${anchorRectFn}(${selectedAnnotationVar}.annotation.anchor),${radiusVar}=void 0,${highlightClassVar}=${highlightFn}(${selectedAnnotationVar}.annotation.anchor,${rectVar},${widthSourceVar}.width,${heightSourceVar}.height)}`,
      );
    } else {
      console.warn("WARN: Could not find browser annotation screenshot element highlight — skipping screenshot anchor patch");
    }
  }

  const allMarkersInScreenshotNeedle =
    "de=u?.target.mode===`create`?ce.find(e=>Sd(e.anchor,u.anchor.value))??null:null,fe=!M&&de!=null?ce.filter(e=>e.id!==de.id):ce,";
  const selectedMarkerInScreenshotPatch =
    "de=u?.target.mode===`create`?ce.find(e=>Sd(e.anchor,u.anchor.value))??null:null,fe=M?ue:!M&&de!=null?ce.filter(e=>e.id!==de.id):ce,";
  if (patchedSource.includes(selectedMarkerInScreenshotPatch)) {
    // Already patched.
  } else if (/=\([A-Za-z_$][\w$]*\?[A-Za-z_$][\w$]*:![A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*!=null\?[A-Za-z_$][\w$]*\.filter\(e=>e\.id!==[A-Za-z_$][\w$]*\.id\):[A-Za-z_$][\w$]*\)\.flatMap/.test(patchedSource)) {
    // Already patched with the current upstream symbol names.
  } else if (patchedSource.includes(allMarkersInScreenshotNeedle)) {
    patchedSource = patchedSource.replace(allMarkersInScreenshotNeedle, selectedMarkerInScreenshotPatch);
  } else {
    const currentMarkersNeedle = "be=(!ge&&ye!=null?A.filter(e=>e.id!==ye.id):A).flatMap";
    const currentMarkersPatch = "be=(ge?he:!ge&&ye!=null?A.filter(e=>e.id!==ye.id):A).flatMap";
    const currentSelectedMarkersNeedle = "Se=(!ve&&xe!=null?k.filter(e=>e.id!==xe.id):k).flatMap";
    const currentSelectedMarkersPatch = "Se=(ve?_e:!ve&&xe!=null?k.filter(e=>e.id!==xe.id):k).flatMap";
    const currentCommentPreloadMarkersNeedle =
      "Xe=(M?j?.kind===`comment`?ge:[]:Ye==null?ge:ge.filter(e=>e.id!==Ye.id)).flatMap";
    const currentCommentPreloadMarkersPatch =
      "Xe=(M?j?.kind===`comment`?ge.filter(e=>e.id===j.annotation.id):[]:Ye==null?ge:ge.filter(e=>e.id!==Ye.id)).flatMap";
    const latestCommentPreloadMarkersNeedle =
      "Je=(We?N?.kind===`comment`?me:[]:qe==null?me:me.filter(e=>e.id!==qe.id)).flatMap";
    const latestCommentPreloadMarkersPatch =
      "Je=(We?N?.kind===`comment`?Ue:[]:qe==null?me:me.filter(e=>e.id!==qe.id)).flatMap";
    if (patchedSource.includes(currentMarkersPatch)) {
      // Already patched.
    } else if (patchedSource.includes(currentSelectedMarkersPatch)) {
      // Already patched.
    } else if (patchedSource.includes(currentCommentPreloadMarkersPatch)) {
      // Already patched.
    } else if (patchedSource.includes(latestCommentPreloadMarkersPatch)) {
      // Already patched.
    } else if (patchedSource.includes(currentMarkersNeedle)) {
      patchedSource = patchedSource.replace(currentMarkersNeedle, currentMarkersPatch);
    } else if (patchedSource.includes(currentSelectedMarkersNeedle)) {
      patchedSource = patchedSource.replace(currentSelectedMarkersNeedle, currentSelectedMarkersPatch);
    } else if (patchedSource.includes(currentCommentPreloadMarkersNeedle)) {
      patchedSource = patchedSource.replace(
        currentCommentPreloadMarkersNeedle,
        currentCommentPreloadMarkersPatch,
      );
    } else if (patchedSource.includes(latestCommentPreloadMarkersNeedle)) {
      patchedSource = patchedSource.replace(
        latestCommentPreloadMarkersNeedle,
        latestCommentPreloadMarkersPatch,
      );
    } else {
      console.warn("WARN: Could not find browser annotation screenshot markers — skipping screenshot marker patch");
    }
  }

  return patchedSource;
}

function detectLatestComposerFooterControls(source) {
  const controlsRegex =
    /function ([A-Za-z_$][\w$]*)\(e\)\{[\s\S]{0,9000}?conversationId:([A-Za-z_$][\w$]*)[\s\S]{0,9000}?FooterInlineControls,\{gap:`normal`,children:\[([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\]\}/;
  const match = source.match(controlsRegex);
  if (match == null) {
    return null;
  }
  const [, functionName, conversationIdVar, firstChildVar, secondChildVar] = match;
  return {
    insertionNeedle: `function ${functionName}(e){`,
    conversationIdVar,
    footerControlsNeedle:
      `FooterInlineControls,{gap:\`normal\`,children:[${firstChildVar},${secondChildVar}]}`,
    footerControlsPatch:
      `FooterInlineControls,{gap:\`normal\`,children:[${firstChildVar},${conversationIdVar}==null?null:(0,Q.jsx)(codexLinuxRateLimitFooter,{conversationId:${conversationIdVar}}),${secondChildVar}]}`,
  };
}

function applyPersistentRateLimitFooterPatch(currentSource) {
  let patchedSource = currentSource;
  const latestFooterControls = detectLatestComposerFooterControls(currentSource);
  const latestFooterFunction =
    "function codexLinuxRateLimitFooter({conversationId:e}){try{let t=(0,$.c)(8),{activeMode:n}=or(e),r=n?.settings.model??null,{data:i}=St(ue),a=ma(i),o=la(i),s=da(a,{activeLimitName:o,selectedModel:r}).filter(og).slice(0,2);if(s.length===0)return null;let c=ht(),l;if(t[0]!==s||t[1]!==c){l=s.map(e=>`${Xh(e.bucket.windowDurationMins??null,c)} ${c.formatNumber(Sa(e.bucket.usedPercent??0),{maximumFractionDigits:0})}%`).join(` / `),t[0]=s,t[1]=c,t[2]=l}else l=t[2];let u;return t[3]!==l?(u=(0,Q.jsx)(`span`,{className:`composer-footer__label--sm inline-flex shrink-0 items-center gap-1.5 rounded-full border border-token-border-light bg-token-main-surface-primary/80 px-2 py-1 text-xs text-token-text-secondary shadow-sm dark:border-white/10`,children:l}),t[3]=l,t[4]=u):u=t[4],u}catch(e){return null}}";

  if (!patchedSource.includes("function codexLinuxRateLimitFooter(")) {
    if (latestFooterControls != null) {
      recordStrategy("rate-limit-footer", "upstream-latest");
      patchedSource = patchedSource.replace(
        latestFooterControls.insertionNeedle,
        `${latestFooterFunction}${latestFooterControls.insertionNeedle}`,
      );
    } else if (currentSource.includes("FooterInlineControls")) {
      // Composer-shaped bundle, but the footer controls drifted from the
      // supported upstream shape.
      recordStrategy("rate-limit-footer", "none");
      console.warn("WARN: Could not insert persistent rate limit footer helper — skipping composer footer limit patch");
      return currentSource;
    } else {
      return currentSource;
    }
  }

  if (
    latestFooterControls != null &&
    !patchedSource.includes(`codexLinuxRateLimitFooter,{conversationId:${latestFooterControls.conversationIdVar}}`) &&
    patchedSource.includes(latestFooterControls.footerControlsNeedle)
  ) {
    patchedSource = patchedSource.replace(
      latestFooterControls.footerControlsNeedle,
      latestFooterControls.footerControlsPatch,
    );
  }

  return patchedSource;
}

function applyLinuxFastModeModelGuardPatch(currentSource) {
  const tierLookupNeedle =
    /([A-Za-z_$][\w$]*)\.serviceTiers\.length\s*>\s*0\s*\|\|\s*\1\.additionalSpeedTiers(?:\?\.|\.)includes\(([^()]*)\)(?:\s*===\s*!0)?/gu;
  const patchedSource = currentSource.replace(
    tierLookupNeedle,
    (match, modelVar, fastTierExpr) =>
      `(${modelVar}?.serviceTiers?.length??0)>0||${modelVar}?.additionalSpeedTiers?.includes(${fastTierExpr})===!0`,
  );
  if (patchedSource !== currentSource) {
    return patchedSource;
  }

  if (/\bserviceTiers\.length\s*>\s*0/u.test(currentSource)) {
    console.warn(
      "WARN: Could not find fast-mode model guard insertion point — skipping fast-mode crash guard patch",
    );
  }

  return currentSource;
}

function patchCommentPreloadBundle(extractedDir) {
  const commentPreloadBundle = path.join(extractedDir, ".vite", "build", "comment-preload.js");
  if (!fs.existsSync(commentPreloadBundle)) {
    console.warn(
      `WARN: Could not find comment preload bundle in ${path.dirname(commentPreloadBundle)} — skipping annotation screenshot patch`,
    );
    return { matched: false, changed: false };
  }

  const source = fs.readFileSync(commentPreloadBundle, "utf8");
  const patchedSource = applyBrowserAnnotationScreenshotPatch(source);
  if (patchedSource !== source) {
    fs.writeFileSync(commentPreloadBundle, patchedSource, "utf8");
    return { matched: true, changed: true };
  }
  return { matched: true, changed: false };
}

module.exports = {
  applyBrowserAnnotationScreenshotPatch,
  applyLinuxAppServerFeatureEnablementPatch,
  applyLinuxBrowserUseAvailabilityPatch,
  applyLinuxBrowserUseExternalAvailabilityPatch,
  applyLinuxBrowserUseNonLocalNavigationPatch,
  applyLinuxConfigWriteVersionConflictPatch,
  applyLinuxI18nGatePatch,
  applyLinuxProfileSettingsMenuPatch,
  applyPersistentRateLimitFooterPatch,
  applyLinuxAppSunsetPatch,
  applyLinuxOpaqueWindowsDefaultPatch,
  applyLinuxThreadSidePanelNativeTooltipPatch,
  applyLinuxTooltipWindowControlsCollisionPatch,
  applyLinuxWindowControlsSafeAreaPatch,
  applyLinuxSafeMonospaceFontStackPatch,
  applyLinuxFastModeModelGuardPatch,
  applyLocalEnvironmentActionModalDraftPatch,
  applySubagentNicknameMetadataPatch,
  patchCommentPreloadBundle,
};
