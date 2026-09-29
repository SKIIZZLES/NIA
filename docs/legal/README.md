# Pages légales NIA — mise en ligne et Play Console

Ces pages existent pour satisfaire deux exigences Google Play que le code seul
ne peut pas couvrir : une **politique de confidentialité** à une URL publique,
et une **page de demande de suppression de compte**.

## 1. Deux champs à remplir avant publication

Les fichiers contiennent des marqueurs `[[…]]`, affichés en orange sur la page :

| Marqueur | Où | Quoi mettre |
|---|---|---|
| `[[NOM DE L'ÉDITEUR]]` / `[[PUBLISHER NAME]]` | `confidentialite.html`, `privacy.html` | Le nom exact affiché comme développeur sur la fiche Google Play. Google exige que l'entité de la fiche apparaisse dans la politique. |
| `[[ADRESSE E-MAIL DE CONTACT]]` / `[[CONTACT EMAIL ADDRESS]]` | les quatre pages | Une adresse à laquelle répondre aux demandes de suppression et aux questions sur les données. |

Je n'ai pas rempli ces champs : publier un nom d'entité ou une adresse
personnelle dans un dépôt public est une décision qui appartient à l'éditeur,
pas à l'outil.

```bash
# une fois les deux valeurs choisies
cd docs/legal
sed -i 's|\[\[NOM DE L.ÉDITEUR[^]]*\]\]|NIA|' confidentialite.html
sed -i 's|\[\[PUBLISHER NAME[^]]*\]\]|NIA|' privacy.html
sed -i 's|\[\[ADRESSE E-MAIL DE CONTACT\]\]|contact@exemple.app|g' *.html
sed -i 's|\[\[CONTACT EMAIL ADDRESS\]\]|contact@exemple.app|g' *.html
grep -r '\[\[' . || echo "aucun marqueur restant"
```

## 2. Activer GitHub Pages

Le dépôt est public, donc Pages est gratuit.

**Settings → Pages → Source : « Deploy from a branch » → branche `main`, dossier `/docs` → Save.**

Le fichier `docs/.nojekyll` est là pour une raison précise : sans lui, Jekyll
ignore certains fichiers et la mise en page ne serait pas servie.

URL obtenues, une à deux minutes après :

| Page | URL |
|---|---|
| Index | `https://skiizzles.github.io/NIA/legal/` |
| Confidentialité (FR) | `https://skiizzles.github.io/NIA/legal/confidentialite.html` |
| Privacy (EN) | `https://skiizzles.github.io/NIA/legal/privacy.html` |
| Suppression (FR) | `https://skiizzles.github.io/NIA/legal/suppression-compte.html` |
| Deletion (EN) | `https://skiizzles.github.io/NIA/legal/delete-account.html` |

Ces URL sont déjà câblées dans `constants/legal.ts` et couvertes par
`__tests__/constants/legal.test.ts`. Changer de domaine plus tard veut dire
changer ce fichier — les tests le rappelleront.

## 3. Champs de la Play Console

| Emplacement | Valeur |
|---|---|
| Store listing → Privacy policy | `…/legal/confidentialite.html` |
| App content → Data safety → Account deletion → URL | `…/legal/suppression-compte.html` |

## 4. Formulaire Data safety

Réponses tirées du code, pas de suppositions. Vérifiées dans `package.json`,
les migrations et les écrans.

| Question | Réponse | Preuve |
|---|---|---|
| L'app collecte-t-elle des données ? | Oui | `auth.users`, `profiles`, `videos` |
| Les données sont-elles chiffrées en transit ? | Oui | HTTPS/TLS vers Supabase |
| L'utilisateur peut-il demander la suppression ? | Oui | Profil → Supprimer mon compte, + page web |
| Données partagées avec des tiers ? | Non | Supabase est un sous-traitant d'hébergement, pas un destinataire tiers au sens du formulaire |

**Types de données à cocher comme collectées :**

| Type | Collecté | Optionnel | Finalité |
|---|---|---|---|
| Adresse e-mail | Oui | Non | Gestion du compte |
| Nom d'utilisateur, nom affiché | Oui | Non | Fonctionnalité de l'app |
| Biographie, photo de profil | Oui | Oui | Fonctionnalité de l'app |
| Photos et vidéos | Oui | Oui | Fonctionnalité de l'app |
| Autre contenu généré (légendes, commentaires) | Oui | Oui | Fonctionnalité de l'app |

**Types à NE PAS cocher**, vérifiés absents du code :

- Position approximative ou précise — aucune permission de localisation, aucune bibliothèque de géolocalisation.
- Informations financières, de santé, biométriques.
- Contacts, SMS, historique d'appels, fichiers et documents.
- Identifiants publicitaires, historique de recherche, activité dans l'app à des fins de publicité.
- Aucun SDK d'analytics, de publicité ou de suivi tiers n'est présent dans `package.json`.

Le champ « région » d'une vidéo est un texte que l'utilisateur saisit ou
choisit. Ce n'est pas une donnée de localisation au sens du formulaire, et
l'app ne lit jamais la position de l'appareil.

## 5. Vérifier après mise en ligne

```bash
for u in confidentialite privacy suppression-compte delete-account; do
  echo -n "$u : "
  curl -s -o /dev/null -w "%{http_code}\n" "https://skiizzles.github.io/NIA/legal/$u.html"
done
```

Les quatre doivent répondre `200`. Google vérifie que l'URL est joignable
publiquement et sans géo-restriction.
