const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios'); // Biblioteca mais estável para o saldo cair na hora

const app = express();
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
    console.log("Gerando PIX para o usuário:", userId);

    try {
        const result = await payment.create({
            body: {
                transaction_amount: parseFloat(valor),
                description: 'Recarga Estacione Colombo',
                payment_method_id: 'pix',
                external_reference: userId, // CRUCIAL: O "crachá" para o Webhook saber quem pagou
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

// 4. ROTA WEBHOOK (BAIXA AUTOMÁTICA DE SALDO)
// 
app.post('/webhook', async (req, res) => {
    // O Mercado Pago avisa qual foi o ID do pagamento aprovado
    const paymentId = req.query["data.id"] || req.body.data?.id;

    if (paymentId) {
        try {
            // Consulta o Mercado Pago usando AXIOS (mais seguro)
            const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const pData = response.data;

            // Se o status for 'approved', a mágica acontece:
            if (pData.status === 'approved') {
                const userId = pData.external_reference; // Recupera o ID do dono do dinheiro
                const valorPago = pData.transaction_amount;

                // Acessa o Firebase e soma o saldo
                const userRef = db.ref(`usuarios/${userId}`);
                const snap = await userRef.once('value');
                const saldoAtual = snap.val()?.saldo || 0;

                await userRef.update({
                    saldo: saldoAtual + valorPago
                });
                
                console.log(`✅ SUCESSO: R$ ${valorPago} creditados ao usuário ${userId}`);
            }
        } catch (err) {
            console.error("❌ Erro ao processar o aviso de pagamento:", err.message);
        }
    }
    // Responde 200 sempre, senão o Mercado Pago fica enviando aviso pra sempre
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
