const crypto = require('crypto');
const supabaseAdmin = require('./supabaseAdmin');

/**
 * Fetch a decrypted secret from Supabase Vault by its name/ref.
 * This must only ever be called from backend code using the
 * service_role client — never expose this path to the frontend.
 *
 * @param {string} secretRef - the name used when the secret was created
 *                              via vault.create_secret(value, name)
 * @returns {Promise<string|null>}
 */
async function getSecret(secretRef) {
  if (!secretRef) return null;

  const { data, error } = await supabaseAdmin
    .from('decrypted_secrets') // Vault's view, lives in the `vault` schema
    .select('decrypted_secret')
    .eq('name', secretRef)
    .single();

  if (error) {
    throw new Error(`Failed to read secret "${secretRef}": ${error.message}`);
  }

  return data ? data.decrypted_secret : null;
}

/**
 * Creates a new Vault secret and returns its name, which is what gets
 * stored in region_credentials as login_secret_ref / service_secret_ref.
 * Uses a unique, unguessable name (not tied to the plaintext value) so
 * the ref itself leaks nothing.
 *
 * @param {string} plaintextValue
 * @param {string} namePrefix - e.g. 'region-login-pw' or 'region-su-pw',
 *                               for easier operator debugging in the
 *                               Vault UI — never includes the secret itself
 * @returns {Promise<string>} the secret's name (the ref to store)
 */
async function createSecret(plaintextValue, namePrefix = 'secret') {
  const uniqueName = `${namePrefix}-${crypto.randomUUID()}`;

  const { error } = await supabaseAdmin.rpc('vault_create_secret', {
    p_secret: plaintextValue,
    p_name: uniqueName,
  });

  if (error) {
    throw new Error(`Failed to create secret: ${error.message}`);
  }

  return uniqueName;
}

/**
 * Updates an existing Vault secret's value in place (e.g. rotating a
 * region's password without changing the stored ref).
 */
async function updateSecret(secretRef, newPlaintextValue) {
  const { error } = await supabaseAdmin.rpc('vault_update_secret', {
    p_name: secretRef,
    p_secret: newPlaintextValue,
  });

  if (error) {
    throw new Error(`Failed to update secret "${secretRef}": ${error.message}`);
  }
}

/**
 * Deletes a Vault secret (e.g. when a region is deleted).
 */
async function deleteSecret(secretRef) {
  if (!secretRef) return;
  const { error } = await supabaseAdmin.rpc('vault_delete_secret', {
    p_name: secretRef,
  });
  if (error) {
    throw new Error(`Failed to delete secret "${secretRef}": ${error.message}`);
  }
}

module.exports = { getSecret, createSecret, updateSecret, deleteSecret };

