const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// 1. FIREBASE (Link do seu banco)
const serviceAccount = require("./samir-calixto-firebase.json");
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://estacione-6cfbf-default-rtdb.firebaseio.com"
    });
}
const db = admin.database();

// 2. MERCADO PAGO (Seu Token que já está no Render)
const token = process.env.MP_ACCESS_TOKEN;
const client = new MercadoPagoConfig({ accessToken: token });
const payment = new Payment(client);

// 3. ROTA GERAR PIX
app.post('/gerar-pix', async (req, res) => {
    const { valor, email, userId } = req.body;
    try {
        const result = await payment.create({
            body: {
                transaction_amount: parseFloat(valor),
                description: 'Recarga Estacione',
                payment_method_id: 'pix',
                external_reference: userId, // CRUCIAL PARA O SALDO SUBIR
                payer: { email }
            }
        });
        res.json({
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/webhook', async (req, res) => {
    // ESTA É A LINHA QUE CORRIGE O 'UNDEFINED'
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.body?.id || req.query?.id;
    
    console.log("🔔 Notificação recebida! ID extraído:", paymentId);

    if (paymentId && paymentId !== 'undefined') {
        try {
            const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.status === 'approved') {
                const userId = response.data.external_reference;
                const valor = response.data.transaction_amount;

                if (userId) {
                    const userRef = db.ref(`usuarios/${userId}`);
                    const snap = await userRef.once('value');
                    const saldoAtual = snap.val()?.saldo || 0;
                    
                    // ATUALIZAÇÃO NO FIREBASE
                    await userRef.update({ saldo: saldoAtual + valor });
                    console.log(`✅ SUCESSO: R$ ${valor} para o usuário ${userId}`);
                } else {
                    console.log("⚠️ Alerta: Pagamento aprovado, mas sem userId.");
                }
            }
        } catch (err) {
            console.log("❌ Erro ao validar pagamento:", err.message);
        }
    }
    res.sendStatus(200);
});

// ÚLTIMA LINHA DO ARQUIVO
app.listen(10000, () => console.log("🚀 Servidor ONLINE na 10000"));
