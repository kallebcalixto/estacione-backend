const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. CONFIGURAÇÃO DO FIREBASE (Usando o seu arquivo exato)
try {
    const serviceAccount = require("./samir-calixto-firebase.json");
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://estacione-6cfbf-default-rtdb.firebaseio.com"
        });
    }
} catch (e) {
    console.error("ERRO FIREBASE:", e.message);
}
const db = admin.database();

// 2. CONFIGURAÇÃO DO MERCADO PAGO
// O .trim() remove espaços invisíveis que causam erro ao copiar o token
const token = process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : null;
const mpClient = new MercadoPagoConfig({ accessToken: token });
const payment = new Payment(mpClient);

// 3. ROTA PARA GERAR PIX
app.post(['/gerar-pix', '/criar-pix'], async (req, res) => {
    const { valor, email, userId } = req.body;
    
    try {
        const result = await payment.create({
            body: {
                transaction_amount: parseFloat(valor),
                description: 'Recarga Estacione Colombo',
                payment_method_id: 'pix',
                external_reference: userId, // Identifica quem pagou no Webhook
                payer: { email: email }
            }
        });

        res.json({
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("ERRO DETALHADO MP:", error); // Isso vai aparecer nos Logs do Render
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// 4. ROTA WEBHOOK (Baixa automática do saldo)
app.post('/webhook', async (req, res) => {
    const paymentId = req.query["data.id"] || req.body.data?.id;

    if (paymentId) {
        try {
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const pData = await response.json();

            if (pData.status === 'approved') {
                const userId = pData.external_reference;
                const valorPago = pData.transaction_amount;

                const userRef = db.ref(`usuarios/${userId}`);
                const snap = await userRef.once('value');
                const saldoAtual = snap.val()?.saldo || 0;

                await userRef.update({ saldo: saldoAtual + valorPago });
                console.log(`SALDO ATUALIZADO: R$ ${valorPago} para ${userId}`);
            }
        } catch (err) {
            console.error("Erro no Webhook:", err);
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
