/**
 * Which Regulamin a user has accepted, so that a rewrite can be put in front
 * of everyone again (see middleware and /akceptacja-regulaminu).
 *
 * Bump CURRENT_TERMS_VERSION and its label (which /regulamin prints as the
 * date of the last update) on the day a new text is published. Every
 * signed-in user is then asked to accept it before using the dashboard.
 */
export const CURRENT_TERMS_VERSION = "2026-11-12";
export const CURRENT_TERMS_LABEL = "12 listopada 2026";

/**
 * The wording of the biometric consent shown before identity verification,
 * stored with each verification so it can be shown later what someone agreed
 * to. Bump it whenever BIOMETRIC_CONSENT_TEXT changes.
 */
export const BIOMETRIC_CONSENT_VERSION = "2026-11-12";

export const BIOMETRIC_CONSENT_TEXT =
  "Wyrażam wyraźną zgodę na przetwarzanie moich danych biometrycznych: GoMambo porówna moje selfie ze zdjęciem w prawie jazdy przy użyciu usługi Amazon Rekognition (serwery w Unii Europejskiej), żeby potwierdzić, że dokument należy do mnie. Wynik może automatycznie zatwierdzić moje konto albo skierować je do sprawdzenia przez zespół GoMambo. Zgodę mogę w każdej chwili wycofać, pisząc na kontakt@gomambo.pl — usuniemy wtedy zdjęcia, ale bez weryfikacji nie można dodawać ani wynajmować aut.";
