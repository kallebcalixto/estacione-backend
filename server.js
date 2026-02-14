const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Configuração de CORS e JSON
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. CONFIGURAÇÃO DO FIREBASE
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
const token = process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : null;
const mpClient = new MercadoPagoConfig({ accessToken: token });
const payment = new Payment(mpClient);

// 3. ROTA PARA GERAR PIX
app.post(['/gerar-pix', '/criar-pix'], async (req, res) => {
    const { valor, email, userId } = req.body;
    console.log("Recebido pedido de PIX para usuário:", userId);

    try {
        const result = await payment.create({
            body: {
                transaction_amount: parseFloat(valor),
                description: 'Recarga Estacione Colombo',
                payment_method_id: 'pix',
                external_reference: userId, // Importante: Isso identifica quem pagou
                payer: { email: email }
            }
        });

        res.json({
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("Erro ao gerar PIX:", error);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// 4. ROTA WEBHOOK (BAIXA AUTOMÁTICA)
// É aqui que o Mercado Pago avisa que o dinheiro caiu!
app.post('/webhook', async (req, res) => {
    const paymentId = req.query["data.id"] || req.body.data?.id;

    if (paymentId) {
        try {
            // Consulta o status do pagamento no Mercado Pago
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const pData = await response.json();

            // Se o pagamento foi aprovado
            if (pData.status === 'approved') {
                const userId = pData.external_reference; // O userId que enviamos lá em cima
                const valorPago = pData.transaction_amount;

                // Atualiza o saldo no Firebase
                const userRef = db.ref(`usuarios/${userId}`);
                const snap = await userRef.once('value');
                const saldoAtual = snap.val()?.saldo || 0;

                await userRef.update({
                    saldo: saldoAtual + valorPago
                });
                
                console.log(`SUCESSO: R$ ${valorPago} adicionados ao usuário ${userId}`);
            }
        } catch (err) {
            console.error("Erro ao processar Webhook:", err);
        }
    }
    // Responde sempre 200 para o Mercado Pago parar de avisar
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
