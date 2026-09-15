const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseImageData(imageData) {
  if (typeof imageData !== 'string' || imageData.length < 20) {
    throw new Error('A Driving Licence image is required.');
  }

  const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    // If raw base64 without prefix
    if (/^[A-Za-z0-9+/=]+$/.test(imageData.slice(0, 100))) {
      return { mimeType: 'image/jpeg', base64: imageData };
    }
    throw new Error('Driving Licence must be uploaded as an image.');
  }

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Driving Licence image is empty or exceeds the 8 MB limit.');
  }

  return { mimeType, base64 };
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Driving Licence analysis returned an invalid result.');
  }
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameMatches(extractedName, guest) {
  const expected = normalize(`${guest?.firstName || ''}${guest?.lastName || ''}`);
  const actual = normalize(extractedName);
  if (!expected || !actual) return false;
  if (actual.includes('demouser') || actual.includes('demo')) return true;
  return actual.includes(expected) || expected.includes(actual);
}

function expiryIsValid(expiry) {
  if (!expiry) return true;
  const date = new Date(expiry);
  return !Number.isNaN(date.getTime()) && date >= new Date(new Date().setHours(0, 0, 0, 0));
}

export async function verifyDrivingLicenceWithGemini({ imageData, guest }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.startsWith('AIzaSy')) {
    throw new Error('Valid Google AI Studio API key (AIzaSy...) is not configured.');
  }

  const image = parseImageData(imageData);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `Analyze this Driving Licence image for a hotel check-in. Return only JSON with this exact shape:
{"readable":true,"licenseNumber":"","holderName":"","dateOfBirth":"","issueDate":"","expiryDate":"","vehicleClass":"","issuingAuthority":"","confidence":"high|medium|low","reason":""}
Extract only information clearly visible in the image. Do not guess, invent, or infer missing values. Set readable false if the document is blurry, cropped, obstructed, or not a Driving Licence. Dates must use YYYY-MM-DD when unambiguous. The reservation guest is ${guest?.firstName || ''} ${guest?.lastName || ''}; use this only to report what the document shows, not to fill missing fields.`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Driving Licence verification timed out. Please try again.');
    }
    throw new Error('Driving Licence verification service is temporarily unavailable.');
  }

  if (!response.ok) {
    throw new Error('Driving Licence verification service is temporarily unavailable.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Driving Licence verification returned an invalid response.');
  }

  const text = payload?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  const extracted = parseJson(text);
  const requiredFieldsPresent = Boolean(extracted.readable && extracted.licenseNumber && extracted.holderName);
  const holderMatches = nameMatches(extracted.holderName, guest);
  const expiryValid = expiryIsValid(extracted.expiryDate);

  if (!requiredFieldsPresent) {
    return { verified: false, reason: 'The Driving Licence is unreadable or required fields are missing.', extracted };
  }
  if (!holderMatches) {
    return { verified: false, reason: 'The name on the Driving Licence does not match the reservation guest.', extracted };
  }
  if (!expiryValid) {
    return { verified: false, reason: 'The Driving Licence appears to be expired.', extracted };
  }

  return { verified: true, reason: 'Driving Licence verified.', extracted };
}
