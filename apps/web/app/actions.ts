'use server';

export async function subscribeEmail(
  _prevState: { success: boolean; message: string } | null,
  formData: FormData,
): Promise<{ success: boolean; message: string }> {
  const email = formData.get('email');

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { success: false, message: 'Please enter a valid email.' };
  }

  const apiKey = process.env.LOOPS_API_KEY;

  if (!apiKey) {
    return { success: false, message: 'Something went wrong. Try again later.' };
  }

  const response = await fetch('https://app.loops.so/api/v1/contacts/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      email,
      source: 'coming-soon',
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);

    if (data?.message?.includes('already')) {
      return { success: true, message: "You're already on the list!" };
    }

    return { success: false, message: 'Something went wrong. Try again later.' };
  }

  return { success: true, message: "You're in. We'll notify you at launch." };
}
