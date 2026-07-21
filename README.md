# Controle de Pátio Diversos Print

Sistema independente para localização e liberação de carretas e rodotrens.

## Executar

1. Abra o PowerShell nesta pasta.
2. Execute `npm start`.
3. Acesse `http://localhost:3010`.

Usuários iniciais: `admin` / `1234` e `coordenador` / `4321`. As senhas podem ser personalizadas pelas variáveis indicadas em `.env.example`.

## Hospedagem

O projeto inclui `render.yaml` para publicação como Web Service no Render com disco persistente. As senhas são geradas como variáveis protegidas no ambiente online.
