const DEFAULT_DEEPFACE_SERVICE_URL = 'http://127.0.0.1:8001';
const DEFAULT_DEEPFACE_TIMEOUT_MS = 180_000;

function parseImageData(imageData, fieldName) {
  if (typeof imageData !== 'string' || imageData.length < 20) {
    throw new Error(`${fieldName} image is required.`);
  }

  const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error(`${fieldName} image must be a base64 data URL.`);
  }

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error(`${fieldName} image is empty.`);
  }

  return { mimeType, buffer };
}

function getTimeoutMs() {
  const configuredTimeout = Number(process.env.DEEPFACE_TIMEOUT_MS);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_DEEPFACE_TIMEOUT_MS;
}

function getServiceUrl() {
  const configuredUrl = String(process.env.DEEPFACE_SERVICE_URL || DEFAULT_DEEPFACE_SERVICE_URL).trim();
  return configuredUrl.replace(/\/+$/, '').replace(/\/verify$/i, '');
}

function getSafeServiceLabel(serviceUrl) {
  try {
    const url = new URL(serviceUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '<invalid-deepface-url>';
  }
}

function invalidResponse(reason) {
  return {
    verified: false,
    reason,
  };
}

function safeResponseBody(responseText) {
  return String(responseText || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(authorization|cookie|token|api[-_ ]?key)\s*[:=]\s*[^,; ]+/gi, '$1=<redacted>')
    .slice(0, 1000);
}

export async function verifyWithDeepFace({ idImageData, selfieImageData }) {
  const serviceUrl = getServiceUrl();
  const verifyUrl = `${serviceUrl}/verify`;
  const startedAt = Date.now();

  try {
    const idImage = parseImageData(idImageData, 'ID');
    const selfieImage = parseImageData(selfieImageData, 'Selfie');
    const formData = new FormData();

    formData.append(
      'id_image',
      new Blob([idImage.buffer], { type: idImage.mimeType }),
      'id-image.jpg',
    );
    formData.append(
      'selfie_image',
      new Blob([selfieImage.buffer], { type: selfieImage.mimeType }),
      'selfie-image.jpg',
    );

    console.log(`[DeepFace] POST ${getSafeServiceLabel(serviceUrl)}/verify idBytes=${idImage.buffer.length} selfieBytes=${selfieImage.buffer.length}`);

    const response = await fetch(verifyUrl, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(getTimeoutMs()),
    });

    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      const contentType = response.headers.get('content-type') || '<missing>';
      console.error(`[DeepFace] invalid non-JSON response status=${response.status} contentType=${contentType} durationMs=${Date.now() - startedAt} body=${safeResponseBody(responseText) || '<empty>'}`);
      return invalidResponse(`DeepFace service returned a non-JSON response (HTTP ${response.status}). Check the DeepFace Render worker logs.`);
    }

    console.log(`[DeepFace] response status=${response.status} durationMs=${Date.now() - startedAt} body=${JSON.stringify(payload).slice(0, 1000)}`);

    if (!response.ok) {
      return invalidResponse(payload?.reason || 'DeepFace verification failed.');
    }

    if (!payload || typeof payload.verified !== 'boolean') {
      return invalidResponse('DeepFace service returned an invalid verification result.');
    }

    return {
      verified: payload.verified,
      distance: typeof payload.distance === 'number' ? payload.distance : undefined,
      threshold: typeof payload.threshold === 'number' ? payload.threshold : undefined,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error(`[DeepFace] timeout url=${getSafeServiceLabel(serviceUrl)}/verify timeoutMs=${getTimeoutMs()} durationMs=${Date.now() - startedAt}`);
      return invalidResponse(`DeepFace verification timed out after ${getTimeoutMs()}ms.`);
    }

    if (error instanceof Error && /image is required|image must be|image is empty/.test(error.message)) {
      console.error(`[DeepFace] invalid image: ${error.message}`);
      return invalidResponse(error.message);
    }

    console.error(`[DeepFace] request failed url=${getSafeServiceLabel(serviceUrl)}/verify durationMs=${Date.now() - startedAt} error=${errorMessage}`);
    return invalidResponse('DeepFace verification service is unavailable.');
  }
}
