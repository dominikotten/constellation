import { readFileSync, writeFileSync } from 'fs';

const STEP_VAL = `
// ================= HEADLESS VALIDATION (fast-forward stepper) =================
window.__val = {};
(function(){
  const log = m => console.log('[VAL] ' + m);
  log('booting ' + location.pathname);

  // fast-forward: advance sim time 0.5s per rendered frame (all sim timing is timeNow-based)
  const STEP = 0.5;
  let simTime = null;
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => nativeRAF(ts => {
    if (simTime === null) simTime = ts / 1000;
    else simTime += STEP;
    cb(simTime * 1000);
  });
  window.performance.now = () => (simTime === null ? 0 : simTime * 1000);

  // diagnostic: capture camera position right after updateDocs runs
  const nativeUpdateDocs = updateDocs;
  updateDocs = (now, dt) => { nativeUpdateDocs(now, dt); window.__val.afterDocs = camera.position.clone(); };

  window.__val.minCamR = 1e9;
  window.__val.minSphere1Gap = 1e9;
  // watchdog: force-exit after 5 min real time even if something hangs
  const startReal = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - startReal > 300000){
      console.log('[VAL] VALIDATION_TIMEOUT');
      try { window.close(); } catch(e){}
      clearInterval(watchdog);
    }
  }, 5000);
  const iv = setInterval(() => {
    if (phase === PHASE_IDLE && !window.__val.started){
      window.__val.started = true;
      log('click START at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_COMPLETE && !window.__val.docsClicked){
      window.__val.docsClicked = true;
      log('click DOCS at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_DOCS && docsFinished && !window.__val.done){
      window.__val.done = true;
      log('DOCS_FINISHED index=' + docIndex + ' total=' + TOTAL + ' controls=' + controls.enabled + ' camFov=' + camera.fov.toFixed(1));
      log('cameraHome=' + camera.position.toArray().map(v=>v.toFixed(1)).join(','));
      log('speedOpEnd=' + speedMat.opacity.toFixed(2));
      log('minCamRDuringFlights=' + window.__val.minCamR.toFixed(2) + ' (shell=5, core=1)');
      setTimeout(() => {
        log('ALL_VALIDATION_DONE');
        try { window.close(); } catch(e){}
      }, 200);
    }
    // tick diagnostics during DOCS
    if (phase === PHASE_DOCS && !window.__val.done){
      window.__val.tickCount = (window.__val.tickCount || 0) + 1;
      if (window.__val.tickCount <= 14){
        const tA = timeNow - (docStart + Math.min(docIndex, TOTAL - 1) / DOCS_PER_SECOND);
        log('TICK n=' + window.__val.tickCount + ' idx=' + docIndex + ' tA=' + tA.toFixed(2) +
            ' cam=' + camera.position.toArray().map(v=>v.toFixed(2)).join(',') +
            ' r=' + camera.position.length().toFixed(2) +
            ' afterDocs=' + (window.__val.afterDocs ? window.__val.afterDocs.toArray().map(v=>v.toFixed(2)).join(',') : '?'));
      }
    }
    // track min camera radius during flights (should dip inside shell, near core)
    if (phase === PHASE_DOCS && !docsFinished){
      const tActive = timeNow - (docStart + Math.min(docIndex, TOTAL - 1) / DOCS_PER_SECOND);
      if (tActive < WARP_TIME && camera.position.length() < window.__val.minCamR){
        window.__val.minCamR = camera.position.length();
      }
    }
    // sample 2nd sphere flight: speedlines + fov punch + bank + static sphere
    if (phase === PHASE_DOCS && docIndex === 1 && window.__val.sample === undefined){
      const t = timeNow - (docStart + 1 / DOCS_PER_SECOND);
      if (t > 0.25 && t < WARP_TIME - 0.25){
        window.__val.sample = true;
        const tgt = docOrder[1];
        const m = new THREE.Matrix4();
        pointField.getMatrixAt(1, m);
        const sp = new THREE.Vector3().setFromMatrixPosition(m);
        const ss = new THREE.Vector3().setFromMatrixScale(m);
        log('FLIGHT speedOp=' + speedMat.opacity.toFixed(2) +
            ' fov=' + camera.fov.toFixed(1) +
            ' bankZ=' + camera.rotation.z.toFixed(3) +
            ' camR=' + camera.position.length().toFixed(2) +
            ' distTarget=' + camera.position.distanceTo(perfectPositions[tgt]).toFixed(2));
        log('VIEWPOS from=' + docViewPos[0].toArray().map(v=>v.toFixed(2)).join(',') +
            ' to=' + docViewPos[1].toArray().map(v=>v.toFixed(2)).join(',') +
            ' home=' + docHomePos.toArray().map(v=>v.toFixed(2)).join(','));
        log('SPHERE1 static pos=' + sp.toArray().map(v=>v.toFixed(2)).join(',') +
            ' target=' + perfectPositions[tgt].toArray().map(v=>v.toFixed(2)).join(',') +
            ' scale=' + ss.x.toFixed(2));
      }
    }
  }, 25);
})();
`;

const CLICK_VAL = `
// ================= HEADLESS VALIDATION (click-only, for virtual-time screenshots) =================
window.__val = {};
(function(){
  const log = m => console.log('[VAL] ' + m);
  log('booting ' + location.pathname);
  const iv = setInterval(() => {
    if (phase === PHASE_IDLE && !window.__val.started){
      window.__val.started = true;
      log('click START at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_COMPLETE && !window.__val.docsClicked){
      window.__val.docsClicked = true;
      log('click DOCS at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_DOCS && docsFinished && !window.__val.done){
      window.__val.done = true;
      log('DOCS_FINISHED');
    }
  }, 25);
})();
`;

const FIX_VAL = `
// ================= HEADLESS VALIDATION (stepper + controls.update fix) =================
window.__val = {};
(function(){
  const log = m => console.log('[VAL] ' + m);
  log('booting ' + location.pathname);

  // fast-forward: advance sim time 0.5s per rendered frame (all sim timing is timeNow-based)
  const STEP = 0.5;
  let simTime = null;
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => nativeRAF(ts => {
    if (simTime === null) simTime = ts / 1000;
    else simTime += STEP;
    cb(simTime * 1000);
  });
  window.performance.now = () => (simTime === null ? 0 : simTime * 1000);

  // FIX: pause OrbitControls while the camera is under cinematic control (DOCS)
  const nativeCtrlUpdate = controls.update.bind(controls);
  controls.update = () => { if (phase === PHASE_DOCS) return; nativeCtrlUpdate(); };

  window.__val.minCamR = 1e9;
  const iv = setInterval(() => {
    if (phase === PHASE_IDLE && !window.__val.started){
      window.__val.started = true;
      log('click START at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_COMPLETE && !window.__val.docsClicked){
      window.__val.docsClicked = true;
      log('click DOCS at t=' + timeNow.toFixed(1));
      restartBtn.click();
    } else if (phase === PHASE_DOCS && docsFinished && !window.__val.done){
      window.__val.done = true;
      log('DOCS_FINISHED index=' + docIndex + ' total=' + TOTAL + ' controls=' + controls.enabled + ' camFov=' + camera.fov.toFixed(1));
      log('cameraHome=' + camera.position.toArray().map(v=>v.toFixed(1)).join(','));
      log('minCamRDuringFlights=' + window.__val.minCamR.toFixed(2) + ' (shell=5, core=1)');
      setTimeout(() => {
        log('ALL_VALIDATION_DONE');
        try { window.close(); } catch(e){}
      }, 200);
    }
    if (phase === PHASE_DOCS && !docsFinished){
      const tActive = timeNow - (docStart + Math.min(docIndex, TOTAL - 1) / DOCS_PER_SECOND);
      if (tActive < WARP_TIME && camera.position.length() < window.__val.minCamR){
        window.__val.minCamR = camera.position.length();
      }
    }
    if (phase === PHASE_DOCS && docIndex === 1 && window.__val.sample === undefined){
      const t = timeNow - (docStart + 1 / DOCS_PER_SECOND);
      if (t > 0.25 && t < WARP_TIME - 0.25){
        window.__val.sample = true;
        const tgt = docOrder[1];
        const m = new THREE.Matrix4();
        pointField.getMatrixAt(1, m);
        const sp = new THREE.Vector3().setFromMatrixPosition(m);
        const ss = new THREE.Vector3().setFromMatrixScale(m);
        log('FLIGHT speedOp=' + speedMat.opacity.toFixed(2) +
            ' fov=' + camera.fov.toFixed(1) +
            ' bankZ=' + camera.rotation.z.toFixed(3) +
            ' camR=' + camera.position.length().toFixed(2) +
            ' distTarget=' + camera.position.distanceTo(perfectPositions[tgt]).toFixed(2));
        log('SPHERE1 static pos=' + sp.toArray().map(v=>v.toFixed(2)).join(',') +
            ' target=' + perfectPositions[tgt].toArray().map(v=>v.toFixed(2)).join(',') +
            ' scale=' + ss.x.toFixed(2));
      }
    }
  }, 25);
})();
`;

function inject(src, out, block){
  const content = readFileSync(src, 'utf8');
  const re = /<\/script>/g;
  const matches = [...content.matchAll(re)];
  const last = matches[matches.length - 1].index;
  const injected = content.slice(0, last) + block + '</script>' + content.slice(last + '</script>'.length);
  writeFileSync(out, injected);
  console.log('wrote ' + out);
}

inject('index.html', '_val_index.html', STEP_VAL);
inject('constellation.html', '_val_constellation.html', STEP_VAL);
inject('index.html', '_fix_index.html', FIX_VAL);
inject('constellation.html', '_fix_constellation.html', FIX_VAL);
inject('index.html', '_shot_index.html', CLICK_VAL);
inject('constellation.html', '_shot_constellation.html', CLICK_VAL);

