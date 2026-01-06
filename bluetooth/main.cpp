#include "gap.h"
#include <QApplication>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);
    gap w;
    w.show();

    return a.exec();
}
