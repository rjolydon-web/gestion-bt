# Portail DAF — BENIN TOURS S.A.

Outil de gestion financière, comptable, budgétaire, facturation, paie et matières de la Direction administrative et financière.

- Hébergement : GitHub Pages (branche `main`, dossier racine).
- Données et comptes : projet Firebase de BENIN TOURS (Authentication e-mail/mot de passe, Firestore africa-south1).
- `config.js` : paramètres du projet Firebase.
- `firestore.rules` : règles de sécurité à publier dans Firestore > Règles.
- `acces.js` : liaison entre l'outil et Firebase.

Aucune donnée n'est stockée dans ce dépôt, ni le budget (PTA), qui est lu dans la base protégée après connexion. Les accès se gèrent dans l'outil, menu « Accès à l'outil » (propriétaire uniquement).
