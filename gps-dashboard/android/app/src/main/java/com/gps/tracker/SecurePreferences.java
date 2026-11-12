package com.gps.tracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encapsulador de SharedPreferences cifrado usando AndroidKeyStore (AES/GCM/NoPadding).
 * Incluye cabeceras mágicas (ENC:v1:), aislamiento de claves por alias y descarte seguro de datos corruptos.
 */
public class SecurePreferences {
    private static final String TAG = "SecurePreferences";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String DEFAULT_KEY_ALIAS = "GpsTrackerMasterKey";
    private static final String MAGIC_PREFIX = "ENC:v1:";
    private static final String AES_GCM_NOPADDING = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private final SharedPreferences prefs;
    private final String keyAlias;

    public SecurePreferences(Context context, String prefsName) {
        this(context, prefsName, DEFAULT_KEY_ALIAS);
    }

    public SecurePreferences(Context context, String prefsName, String keyAlias) {
        this.prefs = context.getApplicationContext().getSharedPreferences(prefsName, Context.MODE_PRIVATE);
        this.keyAlias = (keyAlias != null && !keyAlias.trim().isEmpty()) ? keyAlias : DEFAULT_KEY_ALIAS;
        ensureMasterKey();
    }

    private synchronized void ensureMasterKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (!keyStore.containsAlias(this.keyAlias)) {
                KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
                KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                        this.keyAlias,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256);
                keyGenerator.init(builder.build());
                keyGenerator.generateKey();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error asegurando clave en KeyStore (alias: " + this.keyAlias + ")", e);
        }
    }

    private SecretKey getMasterKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(this.keyAlias, null);
        return entry != null ? entry.getSecretKey() : null;
    }

    public synchronized boolean putString(String key, String value) {
        if (value == null) {
            return prefs.edit().remove(key).commit();
        }
        try {
            SecretKey secretKey = getMasterKey();
            if (secretKey == null) {
                Log.e(TAG, "Clave no disponible en KeyStore (alias: " + this.keyAlias + "); guardado abortado");
                return false;
            }
            Cipher cipher = Cipher.getInstance(AES_GCM_NOPADDING);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);

            String encoded = MAGIC_PREFIX + Base64.encodeToString(combined, Base64.NO_WRAP);
            return prefs.edit().putString(key, encoded).commit();
        } catch (Exception e) {
            Log.e(TAG, "Error cifrando preferencia " + key + "; guardado abortado por seguridad", e);
            return false;
        }
    }


    public synchronized String getString(String key, String defaultValue) {
        String raw = prefs.getString(key, null);
        if (raw == null) return defaultValue;

        if (raw.startsWith(MAGIC_PREFIX)) {
            String payload = raw.substring(MAGIC_PREFIX.length());
            try {
                SecretKey secretKey = getMasterKey();
                if (secretKey == null) {
                    Log.e(TAG, "Clave no disponible para descifrar " + key + "; descartando dato por seguridad");
                    prefs.edit().remove(key).commit();
                    return defaultValue;
                }

                byte[] combined = Base64.decode(payload, Base64.NO_WRAP);
                if (combined.length <= GCM_IV_LENGTH) {
                    Log.w(TAG, "Payload cifrado corrupto para " + key + "; eliminando clave");
                    prefs.edit().remove(key).commit();
                    return defaultValue;
                }

                byte[] iv = new byte[GCM_IV_LENGTH];
                byte[] encrypted = new byte[combined.length - GCM_IV_LENGTH];
                System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
                System.arraycopy(combined, GCM_IV_LENGTH, encrypted, 0, encrypted.length);

                Cipher cipher = Cipher.getInstance(AES_GCM_NOPADDING);
                GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
                cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
                byte[] decrypted = cipher.doFinal(encrypted);
                return new String(decrypted, StandardCharsets.UTF_8);
            } catch (Exception e) {
                Log.e(TAG, "Fallo al descifrar preferencia " + key + " (posible corrupción/clave alterada). Eliminando entrada corrupta.", e);
                prefs.edit().remove(key).commit();
                return defaultValue;
            }
        } else {
            // Manejo de migración desde texto plano legado: cifrar de forma segura
            boolean migrated = putString(key, raw);
            if (migrated) {
                return raw;
            } else {
                Log.e(TAG, "No se pudo migrar la clave " + key + " a formato cifrado; eliminando entrada no cifrada por seguridad");
                prefs.edit().remove(key).commit();
                return defaultValue;
            }
        }
    }

    public synchronized boolean putLong(String key, long value) {
        return putString(key, String.valueOf(value));
    }

    public synchronized long getLong(String key, long defaultValue) {
        String str = getString(key, null);
        if (str == null) return defaultValue;
        try {
            return Long.parseLong(str);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    public synchronized boolean remove(String key) {
        return prefs.edit().remove(key).commit();
    }
}
