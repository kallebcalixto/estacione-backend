const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Configuração de CORS aberta para evitar bloqueios de navegador
app.use(cors({ origin: '*' }));
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO FIREBASE ---
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

// --- 2. CONFIGURAÇÃO DO MERCADO PAGO ---
// Verificação de segurança para o Token
const token = process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : null;

const mpClient = new MercadoPagoConfig({ 
    accessToken: token 
});
const payment = new Payment(mpClient);

// --- 3. ROTA PARA GERAR PIX ---
app.post(['/gerar-pix', '/criar-pix'], async (req, res) => {
    console.log("Dados recebidos no servidor:", req.body);
    
    try {
        const { valor, email } = req.body;

        if (!valor || !email) {
            console.error("Erro: Dados incompletos");
            return res.status(400).json({ error: "Valor e email são obrigatórios" });
        }

        const paymentBody = {
            transaction_amount: Number(valor),
            description: 'Recarga Estacione Colombo',
            payment_method_id: 'pix',
            payer: {
                email: email.trim(),
                first_name: 'Cliente',
                last_name: 'Estacione'
            },
            // Garanta que esta URL está correta no seu Render
            notification_url: "https://estacione-backend.onrender.com/webhook"
        };

        const response = await payment.create({ body: paymentBody });
        
        console.log("PIX Gerado com sucesso!");
        res.json({ 
            qr_code: response.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64
        });

    } catch (error) {
        // Log detalhado para depuração no Render
        console.error("ERRO DETALHADO MERCADO PAGO:", JSON.stringify(error, null, 2));
        res.status(500).json({ error: "Erro ao gerar PIX no Mercado Pago" });
    }
});

// --- 4. WEBHOOK ---
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;
    if (action === "payment.created" || req.body.type === "payment") {
        const paymentId = data?.id || req.body.data?.id;
        try {
            const pagamento = await payment.get({ id: paymentId });
            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                const emailCliente = pagamento.payer.email;
                const snapshot = await db.ref('usuarios').orderByChild('email').equalTo(emailCliente).once('value');
                if (snapshot.exists()) {
                    const userId = Object.keys(snapshot.val())[0];
                    const saldoAtual = snapshot.val()[userId].saldo || 0;
                    await db.ref(`usuarios/${userId}`).update({ saldo: saldoAtual + valorPago });
                    console.log(`✅ Saldo atualizado para ${emailCliente}`);
                }
            }
        } catch (e) {
            console.error("Erro no processamento do Webhook:", e);
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Servidor Estacione Colombo está Online! ✅'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
