#include "messagebox_dummy.h"

MessageBox::MessageBox(QWidget *parent, SA_TYPE okType, SA_TYPE msgType)
    : QMessageBox(parent), m_okType(okType), m_msgType(msgType)
{
    // Configurar el tipo de mensaje según msgType
    switch (msgType) {
        case SA_WARNING:
            setIcon(QMessageBox::Warning);
            setWindowTitle("Advertencia");
            break;
        case SA_SUCCESS:
            setIcon(QMessageBox::Information);
            setWindowTitle("Éxito");
            break;
        case SA_TIPS:
            setIcon(QMessageBox::Information);
            setWindowTitle("Información");
            break;
        default:
            setIcon(QMessageBox::Information);
            setWindowTitle("Información");
            break;
    }
    
    // Configurar botones según okType
    switch (okType) {
        case SA_OKS:
        default:
            setStandardButtons(QMessageBox::Ok);
            break;
    }
    
    // Configuración para sistemas embebidos
    setModal(true);
    setWindowFlags(Qt::Dialog | Qt::WindowStaysOnTopHint);
}