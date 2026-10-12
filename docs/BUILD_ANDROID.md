# Build Android

O projeto Expo está em `apps/mobile`. Configure em `apps/mobile/.env`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=chave-publica
EXPO_PUBLIC_APP_URL=https://seu-exa.vercel.app
```

Para desenvolvimento: `pnpm --filter @exa/mobile start`.

Para APK release via EAS, o workflow `.github/workflows/android-apk.yml` pode ser iniciado manualmente em GitHub → Actions → Build Android APK (EAS) → Run workflow. Cadastre o segredo `EXPO_TOKEN` e as variáveis públicas `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `EXPO_PUBLIC_APP_URL` em Settings → Secrets and variables → Actions. O workflow valida, vincula/inicializa o projeto EAS e guarda o APK como artifact por 14 dias. Também é possível executar localmente `pnpm dlx eas-cli build -p android --profile production-apk` após autenticar na Expo. O perfil `production-apk` define build APK interno. Guarde credenciais de assinatura fora do repositório.

Para build local, instale JDK e Android SDK, execute `pnpm --filter @exa/mobile exec expo prebuild --platform android` e configure a assinatura release no Gradle antes de `./gradlew assembleRelease`. Um APK debug não substitui a entrega release.

Após gerar o APK, instale com `adb install -r <caminho.apk>`, teste login, câmera/QR, sincronização, PDF e compartilhamento. Registre o SHA-256 do artefato. Neste ambiente não havia SDK/JDK/ADB; portanto, ainda não existe APK release verificado.
