const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Libera o acesso para o seu site no Wix conseguir falar com o servidor
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO FIREBASE ADMIN ---
const serviceAccount = require("./samir-calixto-firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://estacione-6cfbf-default-rtdb.firebaseio.com"
});
const db = admin.database();

// --- 2. CONFIGURAÇÃO DO MERCADO PAGO ---
const mpClient = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN 
});
const payment = new Payment(mpClient);

// --- 3. ROTA PARA GERAR O PIX (CORRIGIDA) ---
// Agora aceita tanto /gerar-pix quanto /criar-pix
app.post(['/gerar-pix', '/criar-pix'], async (req, res) => {
    try {
        const { valor, email } = req.body;

        if (!valor || !email) {
            return res.status(400).json({ error: "Valor e e-mail são obrigatórios" });
        }

        const body = {
            transaction_amount: parseFloat(valor),
            description: 'Recarga Estacione Colombo',
            payment_method_id: 'pix',
            payer: { email: email },
            notification_url: "https://estacione-backend.onrender.com/webhook"
        };

        const response = await payment.create({ body });
        
        // Retorna os dados que o seu site precisa para mostrar o QR Code
        res.json({ 
            qr_code: response.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("Erro detalhado no Mercado Pago:", error);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// --- 4. WEBHOOK (AVISA O PAGAMENTO) ---
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;

    if (action === "payment.created" || req.body.type === "payment") {
        const paymentId = data?.id || req.body.data?.id;

        try {
            const pagamento = await payment.get({ id: paymentId });

            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                const emailCliente = pagamento.payer.email;

                const usersRef = db.ref('usuarios');
                const snapshot = await usersRef.orderByChild('email').equalTo(emailCliente).once('value');

                if (snapshot.exists()) {
                    const userId = Object.keys(snapshot.val())[0];
                    const userDados = snapshot.val()[userId];
                    const novoSaldo = (userDados.saldo || 0) + valorPago;

                    await usersRef.child(userId).update({ saldo: novoSaldo });
                    console.log(`✅ Pago! R$ ${valorPago} creditados para ${emailCliente}`);
                }
            }
        } catch (e) {
            console.error("Erro no Webhook:", e);
        }
    }
    res.sendStatus(200); 
});

app.get('/', (req, res) => res.send('Servidor Online ✅'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
