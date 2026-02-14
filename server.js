const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// 1. Configuração de rede
app.use(cors({ origin: '*' }));
app.use(express.json());

// 2. CONFIGURAÇÃO DO FIREBASE (Nome corrigido para o seu arquivo)
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

// 3. CONFIGURAÇÃO DO MERCADO PAGO
const token = process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : null;
const mpClient = new MercadoPagoConfig({ accessToken: token });
const payment = new Payment(mpClient);

// 4. ROTA PARA GERAR PIX (Enviando o userId para o banco saber quem pagou)
app.post('/gerar-pix', async (req, res) => {
    const { valor, email, userId } = req.body;
    console.log("Gerando PIX para:", userId);

    try {
        const result = await payment.create({
            body: {
                transaction_amount: parseFloat(valor),
                description: 'Recarga Estacione Colombo',
                payment_method_id: 'pix',
                external_reference: userId, // ESSENCIAL: Diz ao sistema quem é o dono do dinheiro
                payer: { email: email }
            }
        });

        res.json({
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("Erro MP:", error);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// 5. ROTA WEBHOOK (A que faz o saldo cair sozinho!)
app.post('/webhook', async (req, res) => {
    // Pega o ID do pagamento que o Mercado Pago enviou
    const paymentId = req.query["data.id"] || req.body.data?.id;

    if (paymentId) {
        try {
            // Consulta o Mercado Pago para confirmar o pagamento
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const pData = await response.json();

            if (pData.status === 'approved') {
                const userId = pData.external_reference; // O ID do usuário que guardamos lá em cima
                const valorPago = pData.transaction_amount;

                // Busca o saldo atual e soma o novo valor
                const userRef = db.ref(`usuarios/${userId}`);
                const snap = await userRef.once('value');
                const saldoAtual = snap.val()?.saldo || 0;

                await userRef.update({
                    saldo: saldoAtual + valorPago
                });
                
                console.log(`SUCESSO: R$ ${valorPago} creditados ao usuário ${userId}`);
            }
        } catch (err) {
            console.error("Erro ao processar Webhook:", err);
        }
    }
    res.sendStatus(200); // Avisa o Mercado Pago que recebemos o aviso
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
