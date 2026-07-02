# Controle de Pátio Diversos Print

Sistema independente para localização e liberação de carretas e rodotrens.

## Executar

1. Abra o PowerShell nesta pasta.
2. Execute `npm start`.
3. Acesse `http://localhost:3010`.

Usuários iniciais: `admin` / `admin123` e `coordenador` / `coord123`. Troque as senhas pelas variáveis indicadas em `.env.example` antes do uso real.

## Hospedagem

O projeto inclui `render.yaml` para publicação como Web Service no Render com disco persistente. As senhas são geradas como variáveis protegidas no ambiente online.
