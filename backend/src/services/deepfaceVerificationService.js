const DEFAULT_DEEPFACE_SERVICE_URL = 'http://127.0.0.1:8001';
const DEFAULT_DEEPFACE_TIMEOUT_MS = 30_000;

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
  return (process.env.DEEPFACE_SERVICE_URL || DEFAULT_DEEPFACE_SERVICE_URL).replace(/\/+$/, '');
}

function invalidResponse(reason) {
  return {
    verified: false,
    reason,
  };
}

export async function verifyWithDeepFace({ idImageData, selfieImageData }) {
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

    const response = await fetch(`${getServiceUrl()}/verify`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(getTimeoutMs()),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      return invalidResponse('DeepFace service returned an invalid response.');
    }

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
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return invalidResponse('DeepFace verification timed out.');
    }

    if (error instanceof Error && /image is required|image must be|image is empty/.test(error.message)) {
      return invalidResponse(error.message);
    }

    return invalidResponse('DeepFace verification service is unavailable.');
  }
}
